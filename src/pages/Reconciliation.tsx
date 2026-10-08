/** Delivery ⟷ Cost reconciliation and the Exceptions dashboard. */
import { useMemo, useState } from 'react';
import type { MatchStatus, ReconciliationRow } from '../lib/types';
import { MATCH_STATUS_LABEL } from '../lib/types';
import { useProjectData } from '../lib/selectors';
import { addOverride, linkRecords, unlinkRecords, useDb } from '../lib/store';
import { normaliseTicket } from '../lib/matching';
import { fmtDate, fmtGbp, fmtPctSigned, fmtRate, fmtTonnes } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Field, Kpi, Modal, StatusBadge } from '../components/ui';
import { FilterControls, dateOk, emptyFilters, optOk, textOk, uniqueSorted, type TableFilters } from '../components/Filters';

const ALL_STATUSES: MatchStatus[] = [
  'COSTED', 'DELIVERED_UNCOSTED', 'COST_NO_DELIVERY', 'TONNAGE_MISMATCH', 'DUPLICATE', 'MATCH_REVIEW',
];

const STATUS_TONE: Record<MatchStatus, string> = {
  COSTED: 'good', DELIVERED_UNCOSTED: 'warn', COST_NO_DELIVERY: 'bad',
  TONNAGE_MISMATCH: 'mismatch', DUPLICATE: 'duplicate', MATCH_REVIEW: 'review',
};

export function ReconciliationPage({ onOpenSchedule }: { onOpenSchedule: (schedule: string) => void }) {
  const data = useProjectData();
  const [f, setF] = useState<TableFilters>(emptyFilters());
  const set = (patch: Partial<TableFilters>) => setF((x) => ({ ...x, ...patch }));
  const [detail, setDetail] = useState<ReconciliationRow | null>(null);

  const rows = useMemo(
    () =>
      data.rows.filter(
        (r) =>
          dateOk(r.deliveryDate || r.costDate, f) &&
          optOk(r.scheduleRef, f.schedule) &&
          optOk(r.location, f.location) &&
          optOk(r.supplier, f.supplier) &&
          (!f.status || r.status === f.status) &&
          (!f.ticket || r.ticketNo.toLowerCase().includes(f.ticket.toLowerCase())) &&
          textOk([r.ticketNo, r.scheduleRef, r.location, r.supplier, r.costRef], f),
      ),
    [data.rows, f],
  );

  const count = (s: MatchStatus) => data.rows.filter((r) => r.status === s).length;

  const columns: Column<ReconciliationRow>[] = [
    { key: 'dDate', header: 'Delivery Date', kind: 'date', render: (r) => (r.deliveryDate ? fmtDate(r.deliveryDate) : '—'), sortValue: (r) => r.deliveryDate },
    { key: 'ticket', header: 'Ticket No', render: (r) => <span className="mono">{r.ticketNo || <em>(missing)</em>}</span>, sortValue: (r) => r.ticketNo },
    { key: 'sched', header: 'Schedule', render: (r) => r.scheduleRef || '—', sortValue: (r) => r.scheduleRef },
    { key: 'loc', header: 'Location', render: (r) => r.location || '—', sortValue: (r) => r.location },
    { key: 'dt', header: 'Delivered t', align: 'right', kind: 'tonnes', render: (r) => fmtTonnes(r.deliveredTonnes, 2), sortValue: (r) => r.deliveredTonnes ?? -1, exportValue: (r) => r.deliveredTonnes },
    { key: 'cDate', header: 'Cost Date', kind: 'date', render: (r) => (r.costDate ? fmtDate(r.costDate) : '—'), sortValue: (r) => r.costDate },
    { key: 'ct', header: 'Costed t', align: 'right', kind: 'tonnes', render: (r) => fmtTonnes(r.costedTonnes, 2), sortValue: (r) => r.costedTonnes ?? -1, exportValue: (r) => r.costedTonnes },
    { key: 'cost', header: 'Cost £', align: 'right', kind: 'money', render: (r) => fmtGbp(r.cost), sortValue: (r) => r.cost ?? -1, exportValue: (r) => r.cost },
    { key: 'rate', header: 'Actual £/t', align: 'right', kind: 'rate', render: (r) => fmtRate(r.actualRate, 2), sortValue: (r) => r.actualRate ?? -1, exportValue: (r) => r.actualRate },
    {
      key: 'var', header: 'Tonnage Var', align: 'right', kind: 'tonnes',
      render: (r) =>
        r.tonnageVariance != null ? (
          <span className={Math.abs(r.tonnageVariance) > 0.005 ? 'num-bad' : ''}>
            {fmtTonnes(r.tonnageVariance, 2)}
            {r.tonnageVariancePct != null && ` (${fmtPctSigned(r.tonnageVariancePct, 1)})`}
          </span>
        ) : '—',
      sortValue: (r) => r.tonnageVariance ?? 0, exportValue: (r) => r.tonnageVariance,
    },
    { key: 'status', header: 'Matching Status', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    { key: 'ref', header: 'Cost Reference', render: (r) => <span className="mono">{r.costRef || '—'}</span>, sortValue: (r) => r.costRef },
    { key: 'method', header: 'Match', render: (r) => <span className="badge b-flat">{r.matchMethod}</span>, sortValue: (r) => r.matchMethod },
  ];

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <Kpi label="Costed" tone="good" value={count('COSTED')} sub="Matched delivery ↔ cost" />
        <Kpi label="Delivered – Uncosted" tone="warn" value={count('DELIVERED_UNCOSTED')} sub="Accrual required" />
        <Kpi label="Cost – No Delivery" tone="bad" value={count('COST_NO_DELIVERY')} sub="Orphan cost records" />
        <Kpi label="Tonnage Mismatch" tone="mismatch" value={count('TONNAGE_MISMATCH')} sub="Material tonnage variance" />
        <Kpi label="Duplicate" tone="duplicate" value={count('DUPLICATE')} sub="Repeated ticket / cost" />
        <Kpi label="Match Review" tone="review" value={count('MATCH_REVIEW')} sub="Ambiguous — never auto-matched" />
      </div>

      <Card
        title="Delivery / cost reconciliation"
        sub="Matched on delivery ticket number (normalised) — click a row to match, unmatch or override status"
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.deliveryId ?? `cost-${r.costId}`}
          rowClass={(r) => (r.status === 'COSTED' ? '' : r.status === 'DELIVERED_UNCOSTED' ? 'r-warn' : 'r-error')}
          onRowClick={setDetail}
          searchFields={(r) => `${r.ticketNo} ${r.scheduleRef} ${r.location} ${r.supplier} ${r.costRef}`}
          searchPlaceholder="Search ticket, schedule, location, cost ref…"
          exportName="Rebar-Reconciliation.xls"
          exportTitle="Delivery / Cost Reconciliation"
          emptyText="Nothing to reconcile yet — import deliveries and costs"
          toolbar={
            <FilterControls
              f={f}
              set={set}
              schedules={uniqueSorted(data.rows.map((r) => r.scheduleRef))}
              locations={uniqueSorted(data.rows.map((r) => r.location))}
              suppliers={uniqueSorted(data.rows.map((r) => r.supplier))}
              statuses={ALL_STATUSES}
            />
          }
        />
      </Card>

      {detail && (
        <TicketDetailModal
          row={detail}
          onClose={() => setDetail(null)}
          onOpenSchedule={() => {
            onOpenSchedule(detail.scheduleRef);
            setDetail(null);
          }}
        />
      )}
    </>
  );
}

function TicketDetailModal({
  row, onClose, onOpenSchedule,
}: { row: ReconciliationRow; onClose: () => void; onOpenSchedule: () => void }) {
  const data = useProjectData();
  const db = useDb();
  const projectId = db.currentProjectId ?? '';
  const [override, setOverride] = useState<MatchStatus | ''>('');
  const [note, setNote] = useState('');
  const [linkPick, setLinkPick] = useState('');

  const delivery = row.deliveryId ? data.deliveries.find((d) => d.id === row.deliveryId) : undefined;
  const base = normaliseTicket(row.ticketNo).replace(/[A-Z]$/, '');

  const candidates = data.costs.filter(
    (c) =>
      c.projectId === projectId &&
      (!row.costId || c.id !== row.costId) &&
      c.ticketNorm &&
      (c.ticketNorm === row.ticketNorm || c.ticketNorm.replace(/[A-Z]$/, '') === base) &&
      !data.rows.some((r) => r.costId === c.id && r.deliveryId && r.deliveryId !== row.deliveryId),
  );
  const unmatchedDeliveries = data.rows.filter((r) => r.deliveryId && !r.costId);

  return (
    <Modal
      title={
        <>
          Ticket <span className="mono">{row.ticketNo || '(missing)'}</span>{' '}
          <StatusBadge status={row.status} />
        </>
      }
      onClose={onClose}
      footer={
        <>
          {row.scheduleRef && (
            <button className="btn" onClick={onOpenSchedule}>
              ◫ Open schedule {row.scheduleRef}
            </button>
          )}
          {row.deliveryId && row.costId && (
            <button
              className="btn danger"
              onClick={() => {
                unlinkRecords(row.deliveryId!, row.costId!);
                onClose();
              }}
            >
              ✂ Unmatch
            </button>
          )}
          <button className="btn" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="grid cols-2">
        <div>
          <div className="section-title">Delivery (site)</div>
          {delivery ? (
            <dl className="kv">
              <dt>Delivery date</dt><dd>{fmtDate(delivery.deliveryDate)}</dd>
              <dt>Schedule</dt><dd>{delivery.scheduleRef || '—'}</dd>
              <dt>Location</dt><dd>{delivery.location || '—'}</dd>
              <dt>Supplier</dt><dd>{delivery.supplier || '—'}</dd>
              <dt>Delivered tonnes</dt><dd>{fmtTonnes(delivery.tonnes, 2)}</dd>
              <dt>Description</dt><dd>{delivery.description || '—'}</dd>
            </dl>
          ) : (
            <div className="muted">No delivery record (cost record without delivery).</div>
          )}
        </div>
        <div>
          <div className="section-title">Cost (external system)</div>
          {row.costId ? (
            <dl className="kv">
              <dt>Cost date</dt><dd>{fmtDate(row.costDate)}</dd>
              <dt>Cost reference</dt><dd>{row.costRef || '—'}</dd>
              <dt>Costed tonnes</dt><dd>{fmtTonnes(row.costedTonnes, 2)}</dd>
              <dt>Cost</dt><dd>{fmtGbp(row.cost)}</dd>
              <dt>Actual £/tonne</dt><dd>{fmtRate(row.actualRate, 2)}</dd>
              <dt>Tonnage variance</dt>
              <dd className={row.tonnageVariance && Math.abs(row.tonnageVariance) > 0.005 ? 'num-bad' : ''}>
                {row.tonnageVariance != null ? `${fmtTonnes(row.tonnageVariance, 2)} (${fmtPctSigned(row.tonnageVariancePct, 1)})` : '—'}
              </dd>
            </dl>
          ) : (
            <div className="muted">No cost record received — delivery is uncosted (accrual applies).</div>
          )}
        </div>
      </div>

      <div className="section-title">Manual matching</div>
      {row.deliveryId && !row.costId && (
        <div className="form-grid cols-2">
          <Field label="Match to cost record (same base ticket shown first)">
            <select value={linkPick} onChange={(e) => setLinkPick(e.target.value)}>
              <option value="">Select a cost record…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ticketNo} — {fmtDate(c.costDate)} — {fmtTonnes(c.costedTonnes, 2)} — {fmtGbp(c.cost)}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn primary"
              disabled={!linkPick}
              onClick={() => {
                linkRecords(row.deliveryId!, linkPick);
                onClose();
              }}
            >
              ✓ Link delivery ↔ cost
            </button>
          </div>
        </div>
      )}
      {row.costId && !row.deliveryId && (
        <div className="form-grid cols-2">
          <Field label="Match to delivery record">
            <select value={linkPick} onChange={(e) => setLinkPick(e.target.value)}>
              <option value="">Select a delivery…</option>
              {unmatchedDeliveries.map((r) => (
                <option key={r.deliveryId} value={r.deliveryId}>
                  {r.ticketNo || '(no ticket)'} — {fmtDate(r.deliveryDate)} — {fmtTonnes(r.deliveredTonnes, 2)} — {r.scheduleRef}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn primary"
              disabled={!linkPick}
              onClick={() => {
                linkRecords(linkPick, row.costId!);
                onClose();
              }}
            >
              ✓ Link delivery ↔ cost
            </button>
          </div>
        </div>
      )}

      <div className="section-title">Status override & note (authorised adjustment)</div>
      <div className="form-grid">
        <Field label="Override derived status">
          <select value={override} onChange={(e) => setOverride(e.target.value as MatchStatus | '')}>
            <option value="">— keep automatic ({MATCH_STATUS_LABEL[row.status]}) —</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{MATCH_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Note (recorded in audit trail)">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. agreed with supplier — small part-load variance" />
        </Field>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            className="btn"
            disabled={!override}
            onClick={() => {
              addOverride({
                projectId,
                target: row.deliveryId ? `delivery:${row.deliveryId}` : `cost:${row.costId}`,
                status: override as MatchStatus,
                note,
              });
              onClose();
            }}
          >
            Save override (audited)
          </button>
        </div>
      </div>
      {row.notes && <div className="pill b-manual" style={{ marginTop: 10 }}>Override note: {row.notes}</div>}
    </Modal>
  );
}

// --- Exceptions -------------------------------------------------------------

export function ExceptionsPage() {
  const data = useProjectData();
  const [kind, setKind] = useState<string | null>(null);

  const details = useMemo(
    () => (kind ? data.exceptionDetails.filter((d) => d.kind === kind) : data.exceptionDetails),
    [data.exceptionDetails, kind],
  );

  const active = data.exceptions.find((e) => e.kind === kind);

  const columns: Column<(typeof details)[0]>[] = [
    {
      key: 'kind', header: 'Exception', render: (d) => (
        <span className="badge b-flat">{data.exceptions.find((e) => e.kind === d.kind)?.label ?? d.kind}</span>
      ),
      sortValue: (d) => d.kind,
    },
    {
      key: 'ticket', header: 'Ticket', render: (d) => (
        <span className="mono">{d.row?.ticketNo ?? d.delivery?.ticketNo ?? d.cost?.ticketNo ?? <em>(missing)</em>}</span>
      ),
      sortValue: (d) => d.row?.ticketNo ?? d.delivery?.ticketNo ?? d.cost?.ticketNo ?? '',
    },
    {
      key: 'date', header: 'Date', kind: 'date',
      render: (d) => fmtDate(d.row?.deliveryDate || d.row?.costDate || d.delivery?.deliveryDate || d.cost?.costDate || ''),
      sortValue: (d) => d.row?.deliveryDate || d.row?.costDate || d.delivery?.deliveryDate || d.cost?.costDate || '',
    },
    {
      key: 'sched', header: 'Schedule', render: (d) => d.row?.scheduleRef ?? d.delivery?.scheduleRef ?? '—',
      sortValue: (d) => d.row?.scheduleRef ?? d.delivery?.scheduleRef ?? '',
    },
    {
      key: 'loc', header: 'Location', render: (d) => d.row?.location ?? d.delivery?.location ?? '—',
      sortValue: (d) => d.row?.location ?? d.delivery?.location ?? '',
    },
    {
      key: 't', header: 'Tonnes', align: 'right', kind: 'tonnes',
      render: (d) => fmtTonnes(d.row?.deliveredTonnes ?? d.row?.costedTonnes ?? d.delivery?.tonnes ?? d.cost?.costedTonnes ?? null, 2),
      sortValue: (d) => d.row?.deliveredTonnes ?? d.row?.costedTonnes ?? d.delivery?.tonnes ?? d.cost?.costedTonnes ?? -1,
    },
    {
      key: 'cost', header: 'Cost £', align: 'right', kind: 'money',
      render: (d) => (d.row?.cost != null ? fmtGbp(d.row.cost) : d.cost ? fmtGbp(d.cost.cost) : '—'),
      sortValue: (d) => d.row?.cost ?? d.cost?.cost ?? -1,
    },
    {
      key: 'rate', header: '£/t', align: 'right', kind: 'rate',
      render: (d) => (d.rate != null ? fmtRate(d.rate, 2) : d.row?.actualRate != null ? fmtRate(d.row.actualRate, 2) : '—'),
      sortValue: (d) => d.rate ?? d.row?.actualRate ?? -1,
    },
    {
      key: 'status', header: 'Status', render: (d) => {
        const st = d.row?.status;
        return st ? <StatusBadge status={st} /> : <span className="badge b-flat">{data.exceptions.find((e) => e.kind === d.kind)?.label}</span>;
      },
      sortValue: (d) => d.row?.status ?? d.kind,
    },
  ];

  return (
    <>
      <div className="grid cols-4">
        {data.exceptions.map((e) => (
          <div
            key={e.kind}
            className={`kpi ${e.count > 0 ? (e.kind.includes('COSTED') ? 'k-warn' : 'k-bad') : 'k-good'}`}
            style={{ cursor: e.count > 0 ? 'pointer' : 'default', opacity: e.count > 0 ? 1 : 0.65 }}
            onClick={() => e.count > 0 && setKind(kind === e.kind ? null : e.kind)}
          >
            <div className="kpi-label">{e.label}</div>
            <div className="kpi-value">{e.count}</div>
            <div className="kpi-sub">
              {e.count > 0 ? `${fmtTonnes(e.tonnes, 2)} · ${fmtGbp(e.value)}` : 'None'}
            </div>
          </div>
        ))}
      </div>

      <Card
        title={active ? `Investigate: ${active.label}` : 'All exception records'}
        sub={active ? active.description : 'Every unmatched, duplicated, incomplete or abnormal record'}
        right={
          kind ? (
            <button className="btn" onClick={() => setKind(null)}>✕ Clear selection</button>
          ) : (
            <span className="muted">{details.length} records</span>
          )
        }
      >
        <DataTable
          columns={columns}
          rows={details}
          rowKey={(d) => `${d.kind}-${d.row?.deliveryId ?? d.row?.costId ?? d.delivery?.id ?? d.cost?.id ?? d.row?.ticketNo ?? Math.random()}`}
          searchFields={(d) =>
            `${d.row?.ticketNo ?? ''} ${d.row?.scheduleRef ?? ''} ${d.row?.location ?? ''} ${d.delivery?.ticketNo ?? ''} ${d.cost?.ticketNo ?? ''} ${d.cost?.costRef ?? ''}`
          }
          exportName="Rebar-Exceptions.xls"
          exportTitle="Reconciliation Exceptions"
          emptyText="No exceptions — reconciliation is clean"
        />
      </Card>
    </>
  );
}
