/**
 * Reinforcement Budget vs Actual — the primary commercial control screen.
 * Project → Schedule → Location → Delivery → Ticket → Cost drill-down, with the
 * forecast position (accrued + future + actual = forecast final) on every line.
 */
import { useMemo, useState } from 'react';
import type { CommercialLine, ReconciliationRow } from '../lib/types';
import { useProjectData } from '../lib/selectors';
import { GROUP_LABEL, groupKeyOfDelivery, groupKeyOfRow, type GroupBy } from '../lib/commercial';
import {
  fmtDate, fmtGbp, fmtGbpCompact, fmtGbpSigned, fmtPct, fmtPctSigned,
  fmtRate, fmtRateSigned, fmtTonnes, varianceClass,
} from '../lib/format';
import { FORECAST_METHOD_LABEL } from '../lib/types';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Kpi, StatusBadge } from '../components/ui';

const GROUPS: GroupBy[] = ['schedule', 'location', 'element', 'area', 'package', 'phase', 'supplier', 'month'];

/** Rows belonging to a group value (deliveries carry the richer dimensions). */
export function rowsForGroup(
  rows: ReconciliationRow[],
  deliveries: Map<string, { element: string; area: string; package: string; phase: string }>,
  groupBy: GroupBy,
  key: string,
): ReconciliationRow[] {
  return rows.filter((r) => {
    if (groupBy === 'element' || groupBy === 'area' || groupBy === 'package' || groupBy === 'phase') {
      const d = r.deliveryId ? deliveries.get(r.deliveryId) : undefined;
      return d ? groupKeyOfDelivery(d as never, groupBy) === key : false;
    }
    return groupKeyOfRow(r, groupBy) === key;
  });
}

export function BudgetVsActualPage({ onOpenSchedule }: { onOpenSchedule: (key: string) => void }) {
  const data = useProjectData();
  const [groupBy, setGroupBy] = useState<GroupBy>('schedule');
  const lines = useMemo(() => data.groupLines(groupBy), [data, groupBy]);
  const t = data.totals;

  const columns: Column<CommercialLine>[] = [
    {
      key: 'key', header: GROUP_LABEL[groupBy], width: 150,
      render: (l) => (
        <strong>
          {l.key === '(unallocated)' ? '(no schedule ref)' : l.key}
          {l.overDelivered && <span className="badge b-mismatch" style={{ marginLeft: 6 }}>Over-delivered</span>}
          {l.key === '(unallocated)' && <span className="badge b-uncosted" style={{ marginLeft: 6 }}>Unallocated</span>}
        </strong>
      ),
      sortValue: (l) => l.key,
    },
    { key: 'bt', header: 'Budget t', align: 'right', kind: 'tonnes', render: (l) => fmtTonnes(l.budgetTonnes), sortValue: (l) => l.budgetTonnes, exportValue: (l) => l.budgetTonnes },
    { key: 'dt', header: 'Delivered t', align: 'right', kind: 'tonnes', render: (l) => fmtTonnes(l.deliveredTonnes), sortValue: (l) => l.deliveredTonnes, exportValue: (l) => l.deliveredTonnes },
    { key: 'ct', header: 'Costed t', align: 'right', kind: 'tonnes', render: (l) => fmtTonnes(l.costedTonnes), sortValue: (l) => l.costedTonnes, exportValue: (l) => l.costedTonnes },
    { key: 'at', header: 'Accrued t', align: 'right', kind: 'tonnes', render: (l) => fmtTonnes(l.uncostedTonnes), sortValue: (l) => l.uncostedTonnes, exportValue: (l) => l.uncostedTonnes },
    {
      key: 'rt', header: 'Remaining t', align: 'right', kind: 'tonnes',
      render: (l) => <span className={l.remainingTonnes < 0 ? 'num-bad' : ''}>{fmtTonnes(l.remainingTonnes)}</span>,
      sortValue: (l) => l.remainingTonnes, exportValue: (l) => l.remainingTonnes,
    },
    { key: 'b£', header: 'Budget £', align: 'right', kind: 'money', render: (l) => fmtGbpCompact(l.budgetValue), sortValue: (l) => l.budgetValue, exportValue: (l) => l.budgetValue },
    { key: 'a£', header: 'Actual £', align: 'right', kind: 'money', render: (l) => fmtGbpCompact(l.actualCost), sortValue: (l) => l.actualCost, exportValue: (l) => l.actualCost },
    { key: 'ac£', header: 'Accrued £', align: 'right', kind: 'money', render: (l) => fmtGbpCompact(l.accruedCost), sortValue: (l) => l.accruedCost, exportValue: (l) => l.accruedCost },
    { key: 'f£', header: 'Forecast £', align: 'right', kind: 'money', render: (l) => <strong>{fmtGbpCompact(l.forecastFinalCost)}</strong>, sortValue: (l) => l.forecastFinalCost, exportValue: (l) => l.forecastFinalCost },
    {
      key: 'var£', header: 'Var £', align: 'right', kind: 'money',
      render: (l) => <span className={`num-${varianceClass(l.costVariance)}`}>{fmtGbpSigned(l.costVariance)}</span>,
      sortValue: (l) => l.costVariance, exportValue: (l) => l.costVariance,
    },
    {
      key: 'var%', header: 'Var %', align: 'right', kind: 'pct',
      render: (l) => <span className={`num-${varianceClass(l.costVariance)}`}>{fmtPctSigned(l.costVariancePct)}</span>,
      sortValue: (l) => l.costVariancePct, exportValue: (l) => l.costVariancePct,
    },
    { key: 'br', header: 'Budget £/t', align: 'right', kind: 'rate', render: (l) => fmtRate(l.budgetRate), sortValue: (l) => l.budgetRate, exportValue: (l) => l.budgetRate },
    { key: 'ar', header: 'Actual £/t', align: 'right', kind: 'rate', render: (l) => (l.costedTonnes > 0 ? fmtRate(l.actualRate) : '—'), sortValue: (l) => l.actualRate, exportValue: (l) => (l.costedTonnes > 0 ? l.actualRate : null) },
    { key: 'fr', header: 'Forecast £/t', align: 'right', kind: 'rate', render: (l) => fmtRate(l.forecastRate), sortValue: (l) => l.forecastRate, exportValue: (l) => l.forecastRate },
    {
      key: 'rv', header: '£/t Var', align: 'right', kind: 'rate',
      render: (l) => <span className={`num-${varianceClass(l.rateVariance)}`}>{fmtRateSigned(l.rateVariance)}</span>,
      sortValue: (l) => l.rateVariance, exportValue: (l) => l.rateVariance,
    },
    {
      key: 'chk', header: 'Qty ✓', align: 'right',
      render: (l) => (l.identityOk ? <span className="identity-ok">✓</span> : <span className="identity-bad">!</span>),
      sortValue: (l) => (l.identityOk ? 1 : 0),
    },
  ];

  return (
    <>
      <div className="kpis">
        <Kpi label="Budget" value={fmtTonnes(t.budgetTonnes)} sub={`${fmtGbp(t.budgetValue)} · ${fmtRate(t.budgetRate)}`} />
        <Kpi
          label="Delivered" tone="steel" value={fmtTonnes(t.deliveredTonnes)}
          sub={<>{fmtPct(t.budgetTonnes ? (t.deliveredTonnes / t.budgetTonnes) * 100 : 0)} of budget</>}
        />
        <Kpi label="Costed" tone="good" value={fmtTonnes(t.costedTonnes)} sub={`Actual ${fmtGbp(t.actualCost)} · ${fmtRate(t.actualRate)}`} />
        <Kpi label="Accrued" tone="warn" value={fmtTonnes(t.uncostedTonnes)} sub={`Est ${fmtGbp(t.accruedCost)} (delivered, uncosted)`} />
        <Kpi label="Remaining" value={fmtTonnes(t.remainingTonnes)} sub={`Forecast ${fmtGbp(t.futureCost)}`} />
        <Kpi label="Forecast Final" value={fmtTonnes(t.forecastFinalTonnes)} sub={`${fmtGbp(t.forecastFinalCost)} · ${fmtRate(t.forecastRate)}`} />
        <Kpi
          label="Variance" tone={t.costVariance > 0 ? 'bad' : 'good'}
          value={<span className={`num-${varianceClass(t.costVariance)}`}>{fmtGbpSigned(t.costVariance)}</span>}
          sub={<span className={`num-${varianceClass(t.costVariance)}`}>{fmtPctSigned(t.costVariancePct)} vs budget</span>}
        />
      </div>

      <Card
        title={`Budget vs Actual — by ${GROUP_LABEL[groupBy]}`}
        sub={`Forecast rate: ${FORECAST_METHOD_LABEL[data.forecast.method]} · click a row to drill down`}
        right={
          <>
            <select className="txt" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>Group by: {GROUP_LABEL[g]}</option>
              ))}
            </select>
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(l) => l.key}
          onRowClick={(l) => onOpenSchedule(l.key)}
          searchFields={(l) => l.key}
          searchPlaceholder={`Search ${GROUP_LABEL[groupBy].toLowerCase()}…`}
          exportName={`Budget-vs-Actual-by-${groupBy}.xls`}
          exportTitle={`Budget vs Actual by ${GROUP_LABEL[groupBy]}`}
          emptyText="No budget or delivery data for this project yet"
          footer={
            <tr>
              <td>Total</td>
              <td className="num">{fmtTonnes(t.budgetTonnes)}</td>
              <td className="num">{fmtTonnes(t.deliveredTonnes)}</td>
              <td className="num">{fmtTonnes(t.costedTonnes)}</td>
              <td className="num">{fmtTonnes(t.uncostedTonnes)}</td>
              <td className="num">{fmtTonnes(t.remainingTonnes)}</td>
              <td className="num">{fmtGbpCompact(t.budgetValue)}</td>
              <td className="num">{fmtGbpCompact(t.actualCost)}</td>
              <td className="num">{fmtGbpCompact(t.accruedCost)}</td>
              <td className="num">{fmtGbpCompact(t.forecastFinalCost)}</td>
              <td className={`num num-${varianceClass(t.costVariance)}`}>{fmtGbpSigned(t.costVariance)}</td>
              <td className={`num num-${varianceClass(t.costVariance)}`}>{fmtPctSigned(t.costVariancePct)}</td>
              <td className="num">{fmtRate(t.budgetRate)}</td>
              <td className="num">{t.costedTonnes > 0 ? fmtRate(t.actualRate) : '—'}</td>
              <td className="num">{fmtRate(t.forecastRate)}</td>
              <td className={`num num-${varianceClass(t.rateVariance)}`}>{fmtRateSigned(t.rateVariance)}</td>
              <td className="num">{t.identityOk ? <span className="identity-ok">✓</span> : <span className="identity-bad">!</span>}</td>
            </tr>
          }
        />
        <div className="card-body muted" style={{ borderTop: '1px solid var(--line)' }}>
          Budget = Costed + Accrued + Remaining · Accrued = delivered but uncosted (never treated as future
          quantity) · Forecast final = Actual + Accrued + Remaining × forecast rate. Orphan cost records
          (cost with no delivery) are excluded from schedule totals — see Exceptions.
        </div>
      </Card>
    </>
  );
}

export function ScheduleDetailPage({ scheduleRef, onBack }: { scheduleRef: string; onBack: () => void }) {
  const data = useProjectData();
  const line = data.scheduleLines.find((l) => l.key === scheduleRef);
  const rows = rowsForGroup(
    data.rows,
    new Map(data.deliveries.map((d) => [d.id, d])),
    'schedule',
    scheduleRef,
  );
  if (!line) {
    return (
      <Card title={`Schedule ${scheduleRef}`}>
        <div className="empty">
          No budget or delivery data found for {scheduleRef}.{' '}
          <button className="btn small" onClick={onBack}>◀ Back</button>
        </div>
      </Card>
    );
  }
  return (
    <CommercialDetail
      title={`Schedule ${line.key}`}
      subtitle={describeLine(data.budget, scheduleRef)}
      line={line}
      rows={rows}
      onBack={onBack}
    />
  );
}

function describeLine(budget: { scheduleRef: string; description: string; location: string }[], ref: string): string {
  const lines = budget.filter((b) => b.scheduleRef === ref);
  if (lines.length === 0) return '';
  const desc = [...new Set(lines.map((l) => l.description))].join(' / ');
  const loc = [...new Set(lines.map((l) => l.location))].join(' / ');
  return [desc, loc].filter(Boolean).join(' — ');
}

export function CommercialDetail({
  title, subtitle, line, rows, onBack,
}: {
  title: string;
  subtitle?: string;
  line: CommercialLine;
  rows: ReconciliationRow[];
  onBack: () => void;
}) {
  const cols: Column<ReconciliationRow>[] = [
    { key: 'date', header: 'Delivery Date', kind: 'date', render: (r) => (r.deliveryDate ? fmtDate(r.deliveryDate) : '—'), sortValue: (r) => r.deliveryDate, exportValue: (r) => r.deliveryDate },
    { key: 'ticket', header: 'Ticket No', render: (r) => <span className="mono">{r.ticketNo || '(missing)'}</span>, sortValue: (r) => r.ticketNo },
    { key: 'sched', header: 'Schedule', render: (r) => r.scheduleRef || '—', sortValue: (r) => r.scheduleRef },
    { key: 'loc', header: 'Location', render: (r) => r.location || '—', sortValue: (r) => r.location },
    { key: 'sup', header: 'Supplier', render: (r) => r.supplier || '—', sortValue: (r) => r.supplier },
    { key: 'dt', header: 'Delivered t', align: 'right', kind: 'tonnes', render: (r) => fmtTonnes(r.deliveredTonnes), sortValue: (r) => r.deliveredTonnes ?? -1, exportValue: (r) => r.deliveredTonnes },
    { key: 'cdate', header: 'Cost Date', kind: 'date', render: (r) => (r.costDate ? fmtDate(r.costDate) : '—'), sortValue: (r) => r.costDate },
    { key: 'ct', header: 'Costed t', align: 'right', kind: 'tonnes', render: (r) => fmtTonnes(r.costedTonnes), sortValue: (r) => r.costedTonnes ?? -1, exportValue: (r) => r.costedTonnes },
    { key: 'cost', header: 'Cost £', align: 'right', kind: 'money', render: (r) => fmtGbp(r.cost), sortValue: (r) => r.cost ?? -1, exportValue: (r) => r.cost },
    { key: 'rate', header: 'Actual £/t', align: 'right', kind: 'rate', render: (r) => fmtRate(r.actualRate, 2), sortValue: (r) => r.actualRate ?? -1, exportValue: (r) => r.actualRate },
    { key: 'var', header: 'Tonnage Var', align: 'right', kind: 'tonnes', render: (r) => (r.tonnageVariance != null ? <span className={Math.abs(r.tonnageVariance) > 0.005 ? 'num-bad' : ''}>{fmtTonnes(r.tonnageVariance, 2)}</span> : '—'), sortValue: (r) => r.tonnageVariance ?? 0, exportValue: (r) => r.tonnageVariance },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    { key: 'cref', header: 'Cost Ref', render: (r) => r.costRef || '—', sortValue: (r) => r.costRef },
  ];

  return (
    <>
      <Card>
        <div className="card-body">
          <div className="drill-head">
            <button className="btn small" onClick={onBack}>◀ Back</button>
            <h2>{title}</h2>
            {subtitle && <span className="muted">{subtitle}</span>}
            <span className="pill" style={{ marginLeft: 'auto' }}>
              Forecast rate: {FORECAST_METHOD_LABEL[line.forecastRateMethod]} — {fmtRate(line.forecastRate)}
            </span>
          </div>
          <div className="muted" style={{ margin: '6px 0 16px', fontSize: 11.5 }}>{line.forecastRateSource}</div>

          <div className="grid cols-4">
            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-head"><h2>Budget</h2></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Budget quantity</dt><dd>{fmtTonnes(line.budgetTonnes)}</dd>
                  <dt>Budget value</dt><dd>{fmtGbp(line.budgetValue)}</dd>
                  <dt>Budget rate</dt><dd>{fmtRate(line.budgetRate)}</dd>
                  <dt>Forecast final qty</dt><dd>{fmtTonnes(line.forecastFinalTonnes)}</dd>
                </dl>
              </div>
            </div>
            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-head"><h2>Current Position</h2></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Delivered</dt><dd>{fmtTonnes(line.deliveredTonnes)}</dd>
                  <dt>Costed</dt><dd>{fmtTonnes(line.costedTonnes)}</dd>
                  <dt>Uncosted (accrued)</dt><dd>{fmtTonnes(line.uncostedTonnes)}</dd>
                  <dt>Remaining</dt><dd className={line.remainingTonnes < 0 ? 'num-bad' : ''}>{fmtTonnes(line.remainingTonnes)}</dd>
                </dl>
              </div>
            </div>
            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-head"><h2>Cost</h2></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Actual cost</dt><dd>{fmtGbp(line.actualCost)}</dd>
                  <dt>Actual rate</dt><dd>{line.costedTonnes > 0 ? fmtRate(line.actualRate, 2) : '—'}</dd>
                  <dt>Budget rate</dt><dd>{fmtRate(line.budgetRate)}</dd>
                  <dt>Rate variance</dt>
                  <dd className={`num-${varianceClass(line.rateVariance)}`}>{fmtRateSigned(line.rateVariance, 2)}</dd>
                </dl>
              </div>
            </div>
            <div className="card" style={{ boxShadow: 'none' }}>
              <div className="card-head"><h2>Forecast</h2></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Accrued cost</dt><dd>{fmtGbp(line.accruedCost)}</dd>
                  <dt>Remaining forecast</dt><dd>{fmtGbp(line.futureCost)}</dd>
                  <dt>Forecast final cost</dt><dd><strong>{fmtGbp(line.forecastFinalCost)}</strong></dd>
                  <dt>Forecast rate</dt><dd>{fmtRate(line.forecastRate, 2)}</dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="stat-row" style={{ marginTop: 18, alignItems: 'center' }}>
            <div className="stat">
              <div className="stat-label">Forecast variance</div>
              <div className={`stat-value num-${varianceClass(line.costVariance)}`}>{fmtGbpSigned(line.costVariance)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Forecast variance %</div>
              <div className={`stat-value num-${varianceClass(line.costVariance)}`}>{fmtPctSigned(line.costVariancePct, 2)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Quantity identity</div>
              <div className={`stat-value ${line.identityOk ? 'identity-ok' : 'identity-bad'}`}>
                {line.identityOk ? '✓ Budget = Costed + Accrued + Remaining' : '✕ Discrepancy — investigate'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Position</div>
              <div className="stat-value">
                {line.costVariance > 0.005 ? 'Forecast over budget' : line.costVariance < -0.005 ? 'Forecast under budget' : 'Forecast on budget'}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Delivery → Ticket → Cost detail" sub="Every delivery ticket with its external cost record">
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.deliveryId ?? r.costId ?? r.ticketNorm}
          searchFields={(r) => `${r.ticketNo} ${r.scheduleRef} ${r.location} ${r.supplier} ${r.costRef}`}
          exportName={`${title.replace(/[^A-Za-z0-9]+/g, '-')}-detail.xls`}
          exportTitle={`${title} — delivery & cost detail`}
          emptyText="No deliveries recorded against this group yet"
        />
      </Card>
    </>
  );
}
