/**
 * Ticket number normalisation + automatic delivery/cost matching.
 *
 * Matching key = Delivery Ticket Number. Normalisation tolerates:
 *   – leading/trailing spaces, capitalisation
 *   – leading zeroes in numeric segments  (000123 ≡ 123)
 *   – numeric vs text formatting          (TK-000123-A ≡ tk 123 a)
 *
 * Uncertain matches are NEVER made automatically: when more than one candidate
 * exists on either side, the records are flagged MATCH_REVIEW instead.
 */
import type { CostRecord, Delivery, MatchLink, MatchOverride, MatchStatus, ReconciliationRow } from './types';

/** Normalised ticket key used for matching. */
export function normaliseTicket(raw: string): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  // Purely numeric tickets (incl. Excel "123.0" formatting): compare as numbers.
  if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return String(Number(trimmed));
  // Uppercase, strip all non-alphanumeric characters, drop leading zeroes in
  // every numeric segment so 000123 / 123 / "123.0" collapse together.
  const compact = trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const parts = compact.split(/(\d+)/).filter((p) => p.length > 0);
  return parts
    .map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p))
    .join('');
}

/** Material tonnage tolerance: greater of 0.5t or 2% of delivered. */
export function isTonnageMismatch(delivered: number, costed: number): boolean {
  const diff = Math.abs(costed - delivered);
  const tol = Math.max(0.5, Math.abs(delivered) * 0.02);
  return diff > tol;
}

export interface MatchResult {
  links: MatchLink[]; // system-made links (unique on both sides)
  rows: ReconciliationRow[];
  reviewDeliveryIds: string[];
  reviewCostIds: string[];
}

interface ParsedTicket {
  base: string;
  suffix: string;
}

/**
 * Split a normalised ticket into base + suffix so near-misses like
 * TK123A vs TK123B can be surfaced as possible (ambiguous) matches.
 */
function splitTicket(norm: string): ParsedTicket {
  const m = norm.match(/^(.*?)([A-Z])?$/);
  if (!m) return { base: norm, suffix: '' };
  return { base: m[1] || norm, suffix: m[2] || '' };
}

export function reconcile(
  projectId: string,
  deliveries: Delivery[],
  costs: CostRecord[],
  links: MatchLink[],
  overrides: MatchOverride[],
): MatchResult {
  const now = new Date().toISOString();
  const outLinks: MatchLink[] = [...links];
  const linkedD = new Set(links.filter((l) => l.projectId === projectId).map((l) => l.deliveryId));
  const linkedC = new Set(links.filter((l) => l.projectId === projectId).map((l) => l.costId));

  const dp = deliveries.filter((d) => d.projectId === projectId);
  const cp = costs.filter((c) => c.projectId === projectId);

  // Group by normalised ticket
  const dByTicket = new Map<string, Delivery[]>();
  for (const d of dp) {
    const k = d.ticketNorm || '(missing)';
    (dByTicket.get(k) ?? dByTicket.set(k, []).get(k)!).push(d);
  }
  const cByTicket = new Map<string, CostRecord[]>();
  for (const c of cp) {
    const k = c.ticketNorm || '(missing)';
    (cByTicket.get(k) ?? cByTicket.set(k, []).get(k)!).push(c);
  }

  const reviewDeliveryIds: string[] = [];
  const reviewCostIds: string[] = [];

  // Automatic 1:1 links only where the ticket is unambiguous on both sides.
  for (const [norm, ds] of dByTicket) {
    if (norm === '(missing)') continue;
    const cs = cByTicket.get(norm);
    if (!cs || cs.length === 0) continue;
    const freeD = ds.filter((d) => !linkedD.has(d.id));
    const freeC = cs.filter((c) => !linkedC.has(c.id));
    if (freeD.length === 1 && freeC.length === 1) {
      outLinks.push({
        id: `auto-${freeD[0].id}-${freeC[0].id}`,
        projectId,
        deliveryId: freeD[0].id,
        costId: freeC[0].id,
        method: 'system',
        createdBy: 'system',
        createdAt: now,
      });
      linkedD.add(freeD[0].id);
      linkedC.add(freeC[0].id);
    } else if (freeD.length + freeC.length > 0 && (freeD.length > 1 || freeC.length > 1)) {
      // Ambiguous: several records share the key — never auto-match.
      for (const d of freeD) reviewDeliveryIds.push(d.id);
      for (const c of freeC) reviewCostIds.push(c.id);
    }
  }

  // Possible-but-ambiguous: same base ticket, different suffix (TK123A / TK123B)
  for (const d of dp) {
    if (linkedD.has(d.id) || !d.ticketNorm) continue;
    const { base, suffix } = splitTicket(d.ticketNorm);
    if (!suffix) continue;
    const candidates = cp.filter(
      (c) => !linkedC.has(c.id) && c.ticketNorm && splitTicket(c.ticketNorm).base === base,
    );
    if (candidates.length > 0 && !reviewDeliveryIds.includes(d.id)) {
      reviewDeliveryIds.push(d.id);
      for (const c of candidates) if (!reviewCostIds.includes(c.id)) reviewCostIds.push(c.id);
    }
  }

  const linkByDelivery = new Map<string, MatchLink>();
  const linkByCost = new Map<string, MatchLink>();
  for (const l of outLinks.filter((l) => l.projectId === projectId)) {
    linkByDelivery.set(l.deliveryId, l);
    linkByCost.set(l.costId, l);
  }

  const overrideMap = new Map<string, MatchOverride>();
  for (const o of overrides.filter((o) => o.projectId === projectId)) overrideMap.set(o.target, o);

  const rows: ReconciliationRow[] = [];

  const statusFor = (
    derived: MatchStatus,
    target: string,
  ): MatchStatus | 'CLEAR' => overrideMap.get(target)?.status ?? derived;

  // One row per delivery (with its matched cost, if any)
  for (const d of dp) {
    const link = linkByDelivery.get(d.id);
    const c = link ? cp.find((x) => x.id === link.costId) : undefined;
    const dupDelivery = (dByTicket.get(d.ticketNorm || '(missing)')?.length ?? 0) > 1 && d.ticketNorm !== '';
    const dupCost = c && (cByTicket.get(c.ticketNorm || '(missing)')?.length ?? 0) > 1 && c.ticketNorm !== '';
    let derived: MatchStatus;
    if (d.ticketNorm === '') derived = 'DELIVERED_UNCOSTED';
    else if (dupDelivery || dupCost) derived = 'DUPLICATE';
    else if (!c) derived = reviewDeliveryIds.includes(d.id) ? 'MATCH_REVIEW' : 'DELIVERED_UNCOSTED';
    else if (isTonnageMismatch(d.tonnes, c.costedTonnes)) derived = 'TONNAGE_MISMATCH';
    else derived = 'COSTED';

    const status = (statusFor(derived, `delivery:${d.id}`) === 'CLEAR' ? 'DELIVERED_UNCOSTED' : statusFor(derived, `delivery:${d.id}`)) as MatchStatus;
    const variance = c ? c.costedTonnes - d.tonnes : null;
    rows.push({
      deliveryId: d.id,
      costId: c?.id,
      deliveryDate: d.deliveryDate,
      ticketNo: d.ticketNo,
      ticketNorm: d.ticketNorm,
      scheduleRef: d.scheduleRef,
      location: d.location,
      supplier: d.supplier || c?.supplier || '',
      deliveredTonnes: d.tonnes,
      costDate: c?.costDate ?? '',
      costedTonnes: c?.costedTonnes ?? null,
      cost: c?.cost ?? null,
      costRef: c?.costRef ?? '',
      actualRate: c && c.costedTonnes > 0 ? c.cost / c.costedTonnes : c ? null : null,
      status,
      tonnageVariance: variance,
      tonnageVariancePct: variance != null && d.tonnes !== 0 ? (variance / d.tonnes) * 100 : null,
      matchMethod: link ? link.method : 'none',
      notes: overrideMap.get(`delivery:${d.id}`)?.note ?? '',
    });
  }

  // Orphan cost rows (no delivery)
  for (const c of cp) {
    if (linkByCost.has(c.id)) continue;
    const dupCost = (cByTicket.get(c.ticketNorm || '(missing)')?.length ?? 0) > 1 && c.ticketNorm !== '';
    let derived: MatchStatus;
    if (c.ticketNorm === '') derived = 'COST_NO_DELIVERY';
    else if (dupCost) derived = 'DUPLICATE';
    else derived = reviewCostIds.includes(c.id) ? 'MATCH_REVIEW' : 'COST_NO_DELIVERY';
    const status = (statusFor(derived, `cost:${c.id}`) === 'CLEAR' ? 'COST_NO_DELIVERY' : statusFor(derived, `cost:${c.id}`)) as MatchStatus;
    rows.push({
      costId: c.id,
      deliveryDate: '',
      ticketNo: c.ticketNo,
      ticketNorm: c.ticketNorm,
      scheduleRef: '',
      location: '',
      supplier: c.supplier,
      deliveredTonnes: null,
      costDate: c.costDate,
      costedTonnes: c.costedTonnes,
      cost: c.cost,
      costRef: c.costRef,
      actualRate: c.costedTonnes > 0 ? c.cost / c.costedTonnes : null,
      status,
      tonnageVariance: null,
      tonnageVariancePct: null,
      matchMethod: 'none',
      notes: overrideMap.get(`cost:${c.id}`)?.note ?? '',
    });
  }

  return { links: outLinks, rows, reviewDeliveryIds, reviewCostIds };
}
