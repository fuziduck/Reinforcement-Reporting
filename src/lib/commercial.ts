/**
 * Commercial engine — the authoritative calculation layer.
 *
 * Core quantity identities (validated continuously, §27):
 *   Budget = Delivered + Remaining
 *   Delivered = Costed + Accrued (uncosted)
 *   ⇒ Budget = Costed + Accrued + Remaining
 *
 * Forecast (§28):
 *   Accrued Cost        = Uncosted Tonnes × Forecast Rate   (or manual override)
 *   Forecast Remaining  = Remaining Tonnes × Forecast Rate
 *   Forecast Final Cost = Actual Cost + Accrued Cost + Forecast Remaining Cost
 */
import type {
  BudgetLine,
  CommercialLine,
  CostRecord,
  Delivery,
  ExceptionItem,
  ForecastMethod,
  ForecastSettings,
  ReconciliationRow,
  ValidationIssue,
} from './types';
import { isTonnageMismatch } from './matching';

export type GroupBy =
  | 'schedule'
  | 'location'
  | 'element'
  | 'area'
  | 'package'
  | 'phase'
  | 'supplier'
  | 'month';

export const GROUP_LABEL: Record<GroupBy, string> = {
  schedule: 'Schedule Reference',
  location: 'Location',
  element: 'Structural Element',
  area: 'Area / Zone',
  package: 'Package',
  phase: 'Phase',
  supplier: 'Supplier',
  month: 'Month',
};

export function groupKeyOfBudget(b: BudgetLine, g: GroupBy): string {
  if (g === 'month') return '(no date)';
  if (g === 'schedule') return b.scheduleRef || '(unallocated)';
  return (b[g as keyof BudgetLine] as string) || '(unallocated)';
}

export function groupKeyOfRow(r: ReconciliationRow, g: GroupBy): string {
  if (g === 'month') return (r.deliveryDate || r.costDate || '').slice(0, 7) || '(no date)';
  if (g === 'schedule') return r.scheduleRef || '(unallocated)';
  if (g === 'location') return r.location || '(unallocated)';
  if (g === 'supplier') return r.supplier || '(unallocated)';
  return '';
}

/** Deliveries carry the richer grouping dimensions. */
export function groupKeyOfDelivery(d: Delivery, g: GroupBy): string {
  if (g === 'month') return (d.deliveryDate || '').slice(0, 7) || '(no date)';
  if (g === 'schedule') return d.scheduleRef || '(unallocated)';
  return (d[g as keyof Delivery] as string) || '(unallocated)';
}

export interface RateResolution {
  rate: number;
  method: ForecastMethod;
  source: string;
}

/** Forecast rate: schedule override → project setting (budget / actual / manual). */
export function resolveForecastRate(
  settings: ForecastSettings | undefined,
  scheduleRef: string,
  budgetRate: number,
  actualRate: number | null,
): RateResolution {
  const ov = settings?.scheduleOverrides?.[scheduleRef];
  const method: ForecastMethod = ov?.method ?? settings?.method ?? 'budget';
  const manual = ov?.manualRate ?? settings?.manualRate ?? null;
  switch (method) {
    case 'actual': {
      const r = actualRate != null && isFinite(actualRate) ? actualRate : budgetRate;
      return {
        rate: r,
        method,
        source:
          actualRate != null && isFinite(actualRate)
            ? 'Current actual rate (costed £/t)'
            : 'No costed tonnage — budget rate used as fallback',
      };
    }
    case 'manual':
      return {
        rate: manual ?? budgetRate,
        method,
        source: manual != null ? `Manual forecast rate £${manual.toFixed(0)}/t` : 'No manual rate set — budget rate used as fallback',
      };
    case 'budget':
    default:
      return { rate: budgetRate, method: 'budget', source: 'Original budget rate' };
  }
}

export interface CommercialInput {
  budgetLines: BudgetLine[];
  rows: ReconciliationRow[];
  /** All delivery rows keyed by id, so grouping can follow delivery dimensions. */
  deliveries: Delivery[];
  forecast?: ForecastSettings;
  groupBy: GroupBy;
}

const EPS = 0.001;
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Aggregate budget / delivered / costed / accrued / remaining / forecast for a
 * grouping dimension. Orphan cost records (no delivery) are excluded from the
 * quantity identities and reported separately — they belong to no schedule.
 */
export function computeLines(input: CommercialInput): CommercialLine[] {
  const { budgetLines, rows, forecast, groupBy } = input;
  const deliveryById = new Map(input.deliveries.map((d) => [d.id, d]));

  interface Agg {
    budgetTonnes: number;
    budgetValue: number;
    deliveredTonnes: number;
    costedTonnes: number;
    uncostedTonnes: number;
    actualCost: number;
    schedules: Set<string>;
  }
  const aggs = new Map<string, Agg>();
  const aggFor = (k: string): Agg => {
    let a = aggs.get(k);
    if (!a) {
      a = {
        budgetTonnes: 0, budgetValue: 0, deliveredTonnes: 0,
        costedTonnes: 0, uncostedTonnes: 0, actualCost: 0, schedules: new Set(),
      };
      aggs.set(k, a);
    }
    return a;
  };

  for (const b of budgetLines) {
    const a = aggFor(groupKeyOfBudget(b, groupBy));
    a.budgetTonnes += b.budgetTonnes;
    a.budgetValue += b.budgetValue;
    if (b.scheduleRef) a.schedules.add(b.scheduleRef);
  }

  for (const r of rows) {
    if (!r.deliveryId) continue; // orphan costs handled separately
    const d = deliveryById.get(r.deliveryId);
    const k =
      groupBy === 'month' || groupBy === 'schedule' || groupBy === 'location' || groupBy === 'supplier'
        ? groupKeyOfRow(r, groupBy)
        : d
          ? groupKeyOfDelivery(d, groupBy)
          : '(unallocated)';
    const a = aggFor(k);
    a.deliveredTonnes += r.deliveredTonnes ?? 0;
    if (r.scheduleRef) a.schedules.add(r.scheduleRef);
    const costed = r.costId != null && r.status !== 'DELIVERED_UNCOSTED';
    if (costed) {
      a.costedTonnes += r.deliveredTonnes ?? 0;
      a.actualCost += r.cost ?? 0;
    } else {
      a.uncostedTonnes += r.deliveredTonnes ?? 0;
    }
  }

  const lines: CommercialLine[] = [];
  for (const [key, a] of aggs) {
    const budgetRate = a.budgetTonnes > 0 ? a.budgetValue / a.budgetTonnes : 0;
    const actualRate = a.costedTonnes > 0 ? a.actualCost / a.costedTonnes : null;
    const scheduleRef = a.schedules.size === 1 ? [...a.schedules][0] : '';
    const resolved = resolveForecastRate(forecast, scheduleRef || key, budgetRate, actualRate);
    const overrideKey = scheduleRef || key;
    const accrualOverride = forecast?.accrualOverride?.[overrideKey];
    const remainingTonnes = round(a.budgetTonnes - a.deliveredTonnes);
    const accruedCost = accrualOverride ?? round(a.uncostedTonnes * resolved.rate);
    const futureCost = round(remainingTonnes * resolved.rate);
    const forecastFinalCost = round(a.actualCost + accruedCost + futureCost);
    const forecastFinalTonnes =
      forecast?.forecastTonnesOverride?.[overrideKey] ?? round(a.budgetTonnes);
    const costVariance = round(forecastFinalCost - a.budgetValue);
    const rateVariance = round(resolved.rate - budgetRate);
    lines.push({
      key,
      label: key,
      budgetTonnes: round(a.budgetTonnes),
      budgetRate: round(budgetRate),
      budgetValue: round(a.budgetValue),
      deliveredTonnes: round(a.deliveredTonnes),
      costedTonnes: round(a.costedTonnes),
      uncostedTonnes: round(a.uncostedTonnes),
      remainingTonnes,
      forecastFinalTonnes,
      actualCost: round(a.actualCost),
      actualRate: actualRate != null ? round(actualRate) : 0,
      accruedCost,
      futureCost,
      forecastFinalCost,
      forecastRate: round(resolved.rate),
      forecastRateMethod: resolved.method,
      forecastRateSource: accrualOverride != null ? `${resolved.source} (accrual manually adjusted)` : resolved.source,
      costVariance,
      costVariancePct: a.budgetValue > 0 ? round((costVariance / a.budgetValue) * 100) : 0,
      rateVariance,
      rateVariancePct: budgetRate > 0 ? round((rateVariance / budgetRate) * 100) : 0,
      identityOk:
        Math.abs(a.budgetTonnes - (a.costedTonnes + a.uncostedTonnes + remainingTonnes)) < EPS,
      overDelivered: remainingTonnes < -EPS,
    });
  }
  lines.sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true }));
  return lines;
}

/** Project headline position = roll-up of the schedule lines (true forecast). */
export function totalLine(lines: CommercialLine[]): CommercialLine {
  const t: CommercialLine = {
    key: 'TOTAL', label: 'Project Total',
    budgetTonnes: 0, budgetRate: 0, budgetValue: 0,
    deliveredTonnes: 0, costedTonnes: 0, uncostedTonnes: 0,
    remainingTonnes: 0, forecastFinalTonnes: 0,
    actualCost: 0, actualRate: 0,
    accruedCost: 0, futureCost: 0, forecastFinalCost: 0,
    forecastRate: 0, forecastRateMethod: 'budget', forecastRateSource: 'Roll-up of schedule forecasts',
    costVariance: 0, costVariancePct: 0, rateVariance: 0, rateVariancePct: 0,
    identityOk: true, overDelivered: false,
  };
  for (const l of lines) {
    t.budgetTonnes += l.budgetTonnes; t.budgetValue += l.budgetValue;
    t.deliveredTonnes += l.deliveredTonnes; t.costedTonnes += l.costedTonnes;
    t.uncostedTonnes += l.uncostedTonnes; t.remainingTonnes += l.remainingTonnes;
    t.forecastFinalTonnes += l.forecastFinalTonnes;
    t.actualCost += l.actualCost; t.accruedCost += l.accruedCost;
    t.futureCost += l.futureCost; t.forecastFinalCost += l.forecastFinalCost;
  }
  t.budgetRate = t.budgetTonnes > 0 ? t.budgetValue / t.budgetTonnes : 0;
  t.actualRate = t.costedTonnes > 0 ? t.actualCost / t.costedTonnes : 0;
  t.forecastRate = t.deliveredTonnes + t.remainingTonnes > 0
    ? (t.actualCost + t.accruedCost + t.futureCost) / (t.deliveredTonnes + t.remainingTonnes)
    : t.budgetRate;
  t.costVariance = t.forecastFinalCost - t.budgetValue;
  t.costVariancePct = t.budgetValue > 0 ? (t.costVariance / t.budgetValue) * 100 : 0;
  t.rateVariance = t.forecastRate - t.budgetRate;
  t.rateVariancePct = t.budgetRate > 0 ? (t.rateVariance / t.budgetRate) * 100 : 0;
  t.identityOk = lines.every((l) => l.identityOk);
  t.overDelivered = lines.some((l) => l.overDelivered);
  for (const k of ['budgetTonnes','budgetRate','budgetValue','deliveredTonnes','costedTonnes','uncostedTonnes','remainingTonnes','forecastFinalTonnes','actualCost','actualRate','accruedCost','futureCost','forecastFinalCost','forecastRate','costVariance','costVariancePct','rateVariance','rateVariancePct'] as const) {
    t[k] = round(t[k]);
  }
  return t;
}

/** Continuously validate Budget = Costed + Accrued + Remaining (§27). */
export function validateIdentities(
  lines: CommercialLine[],
  rows: ReconciliationRow[],
  deliveries: Delivery[],
  costs: CostRecord[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const l of lines) {
    if (!l.identityOk) {
      issues.push({
        id: `identity-${l.key}`,
        severity: 'error',
        kind: 'QUANTITY_IDENTITY',
        message: `${l.label}: Budget ≠ Costed + Accrued + Remaining (${l.budgetTonnes}t vs ${(l.costedTonnes + l.uncostedTonnes + l.remainingTonnes).toFixed(1)}t)`,
        targets: [l.key],
      });
    }
    if (l.overDelivered) {
      issues.push({
        id: `over-${l.key}`,
        severity: 'warning',
        kind: 'OVER_DELIVERY',
        message: `${l.label}: delivered exceeds budget by ${(-l.remainingTonnes).toFixed(1)}t`,
        targets: [l.key],
      });
    }
  }
  for (const r of rows) {
    if (r.status === 'TONNAGE_MISMATCH') {
      issues.push({
        id: `tonnage-${r.deliveryId ?? r.costId}`,
        severity: 'warning',
        kind: 'TONNAGE_MISMATCH',
        message: `Ticket ${r.ticketNo}: delivered ${r.deliveredTonnes}t vs costed ${r.costedTonnes}t (variance ${r.tonnageVariance?.toFixed(2)}t)`,
        targets: [r.deliveryId ?? '', r.costId ?? ''].filter(Boolean),
      });
    }
    if (r.status === 'DUPLICATE') {
      issues.push({
        id: `dup-${r.deliveryId ?? r.costId}`,
        severity: 'error',
        kind: 'DUPLICATE',
        message: `Ticket ${r.ticketNo}: duplicate ticket or cost records exist`,
        targets: [r.deliveryId ?? '', r.costId ?? ''].filter(Boolean),
      });
    }
    if (r.status === 'MATCH_REVIEW') {
      issues.push({
        id: `review-${r.deliveryId ?? r.costId}`,
        severity: 'warning',
        kind: 'MATCH_REVIEW',
        message: `Ticket ${r.ticketNo}: ambiguous match — manual review required`,
        targets: [r.deliveryId ?? '', r.costId ?? ''].filter(Boolean),
      });
    }
    if (!r.ticketNorm && (r.deliveryId || r.costId)) {
      issues.push({
        id: `noticket-${r.deliveryId ?? r.costId}`,
        severity: 'warning',
        kind: 'MISSING_TICKET',
        message: `Record without a delivery ticket number — cannot be matched`,
        targets: [r.deliveryId ?? '', r.costId ?? ''].filter(Boolean),
      });
    }
  }
  for (const d of deliveries) {
    if (!d.scheduleRef) {
      issues.push({
        id: `nosched-${d.id}`, severity: 'warning', kind: 'MISSING_SCHEDULE',
        message: `Delivery ${d.ticketNo || d.id} has no schedule reference`, targets: [d.id],
      });
    }
    if (!d.location) {
      issues.push({
        id: `noloc-${d.id}`, severity: 'warning', kind: 'MISSING_LOCATION',
        message: `Delivery ${d.ticketNo || d.id} has no location`, targets: [d.id],
      });
    }
  }
  void costs;
  return issues;
}

/** Exception roll-up for the Exceptions dashboard (§18). */
export interface ExceptionDetail {
  kind: ExceptionItem['kind'];
  row?: ReconciliationRow;
  delivery?: Delivery;
  cost?: CostRecord;
  rate?: number;
}

export function buildExceptions(
  rows: ReconciliationRow[],
  deliveries: Delivery[],
  costs: CostRecord[],
): { items: ExceptionItem[]; details: ExceptionDetail[] } {
  const details: ExceptionDetail[] = [];

  for (const r of rows) {
    if (r.status === 'DELIVERED_UNCOSTED') details.push({ kind: 'DELIVERED_UNCOSTED', row: r });
    if (r.status === 'COST_NO_DELIVERY') details.push({ kind: 'COST_NO_DELIVERY', row: r });
    if (r.status === 'TONNAGE_MISMATCH') details.push({ kind: 'TONNAGE_MISMATCH', row: r });
    if (!r.ticketNorm) {
      details.push({ kind: 'MISSING_TICKET', row: r });
    }
    if (r.deliveryId) {
      const d = deliveries.find((x) => x.id === r.deliveryId);
      if (d && !d.scheduleRef) details.push({ kind: 'MISSING_SCHEDULE', delivery: d });
      if (d && !d.location) details.push({ kind: 'MISSING_LOCATION', delivery: d });
    }
  }

  // Duplicates by normalised ticket within each register
  const dupGroups = (records: { id: string; ticketNorm: string }[]) => {
    const m = new Map<string, string[]>();
    for (const r of records) {
      if (!r.ticketNorm) continue;
      (m.get(r.ticketNorm) ?? m.set(r.ticketNorm, []).get(r.ticketNorm)!).push(r.id);
    }
    return [...m.entries()].filter(([, ids]) => ids.length > 1);
  };
  for (const [, ids] of dupGroups(deliveries.map((d) => ({ id: d.id, ticketNorm: d.ticketNorm })))) {
    for (const id of ids) {
      details.push({ kind: 'DUPLICATE_TICKET', delivery: deliveries.find((d) => d.id === id) });
    }
  }
  for (const [, ids] of dupGroups(costs.map((c) => ({ id: c.id, ticketNorm: c.ticketNorm })))) {
    for (const id of ids) {
      details.push({ kind: 'DUPLICATE_COST', cost: costs.find((c) => c.id === id) });
    }
  }

  // Rate outliers: mean ± 1.5σ of matched rates (flag for review only, §19)
  const rates = rows
    .filter((r) => r.actualRate != null && r.deliveredTonnes != null && r.costId)
    .map((r) => r.actualRate!);
  if (rates.length >= 5) {
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
    const hi = mean + 1.5 * sd;
    const lo = mean - 1.5 * sd;
    for (const r of rows) {
      if (r.actualRate == null || !r.costId) continue;
      if (r.actualRate > hi) details.push({ kind: 'RATE_HIGH', row: r, rate: r.actualRate });
      else if (r.actualRate < lo) details.push({ kind: 'RATE_LOW', row: r, rate: r.actualRate });
    }
  }

  const kinds: ExceptionItem['kind'][] = [
    'DELIVERED_UNCOSTED', 'COST_NO_DELIVERY', 'DUPLICATE_TICKET', 'DUPLICATE_COST',
    'TONNAGE_MISMATCH', 'MISSING_TICKET', 'MISSING_SCHEDULE', 'MISSING_LOCATION',
    'RATE_HIGH', 'RATE_LOW',
  ];
  const labels: Record<ExceptionItem['kind'], [string, string]> = {
    DELIVERED_UNCOSTED: ['Delivered but uncosted', 'Deliveries with no external cost received'],
    COST_NO_DELIVERY: ['Costed but no delivery', 'Cost records with no matching delivery ticket'],
    DUPLICATE_TICKET: ['Duplicate delivery tickets', 'Same ticket number appears more than once'],
    DUPLICATE_COST: ['Duplicate cost records', 'Same ticket number costed more than once'],
    TONNAGE_MISMATCH: ['Tonnage mismatches', 'Delivered and costed tonnages differ materially'],
    MISSING_TICKET: ['Missing ticket numbers', 'Records that cannot be matched'],
    MISSING_SCHEDULE: ['Missing schedule references', 'Deliveries without a schedule reference'],
    MISSING_LOCATION: ['Missing locations', 'Deliveries without a location'],
    RATE_HIGH: ['Unusually high £/tonne', 'Rates well above the norm — review, not assumed wrong'],
    RATE_LOW: ['Unusually low £/tonne', 'Rates well below the norm — review, not assumed wrong'],
  };
  const items: ExceptionItem[] = kinds.map((kind) => {
    const ds = details.filter((d) => d.kind === kind);
    return {
      kind,
      label: labels[kind][0],
      description: labels[kind][1],
      count: ds.length,
      tonnes: ds.reduce((a, d) => a + (d.row?.deliveredTonnes ?? d.row?.costedTonnes ?? d.delivery?.tonnes ?? d.cost?.costedTonnes ?? 0), 0),
      value: ds.reduce((a, d) => a + (d.row?.cost ?? d.delivery?.tonnes ?? d.cost?.cost ?? 0), 0),
    };
  });
  return { items, details };
}

export { isTonnageMismatch };
