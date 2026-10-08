/** Commercial dashboard: headline position, trend charts, validation & exceptions. */
import { useMemo } from 'react';
import { useProjectData } from '../lib/selectors';
import { buildTrends } from '../lib/trends';
import { fmtDate, fmtGbp, fmtGbpCompact, fmtGbpSigned, fmtPct, fmtPctSigned, fmtRate, fmtTonnes, monthLabel, varianceClass } from '../lib/format';
import { FORECAST_METHOD_LABEL } from '../lib/types';
import { BarChart, LineChart } from '../components/charts';
import { Card, Kpi } from '../components/ui';

const NAVY = '#1f3a5f';
const AMBER = '#b45309';
const GREEN = '#157f3d';
const RED = '#b3261e';
const STEEL = '#52606d';
const BLUE = '#1d4ed8';

export function DashboardPage() {
  const data = useProjectData();
  const t = data.totals;
  const trends = useMemo(
    () =>
      buildTrends({
        budget: data.budget,
        deliveries: data.deliveries,
        costs: data.costs,
        rows: data.rows,
        forecastFinalCost: t.forecastFinalCost,
      }),
    [data, t.forecastFinalCost],
  );
  const labels = trends.labels;
  const pctDelivered = t.budgetTonnes ? (t.deliveredTonnes / t.budgetTonnes) * 100 : 0;
  const openExceptions = data.exceptions.filter((e) => e.count > 0);

  return (
    <>
      <div className="kpis">
        <Kpi label="Budget" value={fmtTonnes(t.budgetTonnes)} sub={`${fmtGbp(t.budgetValue)} budget value`} />
        <Kpi label="Delivered" tone="steel" value={fmtTonnes(t.deliveredTonnes)} sub={`${fmtPct(pctDelivered)} of budget`} />
        <Kpi label="Costed" tone="good" value={fmtTonnes(t.costedTonnes)} sub={`${fmtGbp(t.actualCost)} actual cost`} />
        <Kpi label="Accrued" tone="warn" value={fmtTonnes(t.uncostedTonnes)} sub={`${fmtGbp(t.accruedCost)} estimated accrued`} />
        <Kpi label="Remaining" value={fmtTonnes(t.remainingTonnes)} sub={`${fmtGbp(t.futureCost)} forecast remaining`} />
        <Kpi label="Forecast Final" value={fmtTonnes(t.forecastFinalTonnes)} sub={`${fmtGbp(t.forecastFinalCost)} forecast cost`} />
        <Kpi
          label="Variance" tone={t.costVariance > 0 ? 'bad' : 'good'}
          value={<span className={`num-${varianceClass(t.costVariance)}`}>{fmtGbpSigned(t.costVariance)}</span>}
          sub={<span className={`num-${varianceClass(t.costVariance)}`}>{fmtPctSigned(t.costVariancePct)} vs budget</span>}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, margin: '14px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="pill">
          Forecast method: {FORECAST_METHOD_LABEL[data.forecast.method]}
          {data.forecast.method === 'manual' && data.forecast.manualRate != null
            ? ` (${fmtRate(data.forecast.manualRate)})`
            : ''}
        </span>
        <span className={`pill ${data.issues.length === 0 ? '' : 'b-manual'}`}>
          Quantity identities:{' '}
          {data.issues.filter((i) => i.kind === 'QUANTITY_IDENTITY').length === 0
            ? 'Budget = Costed + Accrued + Remaining ✓'
            : 'DISCREPANCIES FOUND'}
        </span>
        <span className="pill">{data.orphanCostCount} cost records without delivery ({fmtGbp(data.orphanCostValue)})</span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
          Data to {fmtDate([...data.deliveries.map((d) => d.deliveryDate), ...data.costs.map((c) => c.costDate)].sort().pop() ?? '')}
        </span>
      </div>

      <div className="chart-grid" style={{ marginTop: 14 }}>
        <LineChart
          title="Cumulative tonnage"
          sub="Budget allowance vs cumulative delivered"
          labels={labels}
          format={(v) => `${Math.round(v)}t`}
          series={[
            { name: 'Budget allowance', color: STEEL, values: trends.cumBudgetLine, dashed: true },
            { name: 'Delivered (cumulative)', color: NAVY, values: trends.cumDelivered },
          ]}
        />
        <LineChart
          title="Cumulative cost"
          sub="Budget value vs actual cost, extended to forecast final"
          labels={[...labels]}
          format={(v) => fmtGbpCompact(v)}
          series={[
            { name: 'Budget value', color: STEEL, values: trends.cumBudgetValueLine, dashed: true },
            { name: 'Actual cost (cumulative)', color: GREEN, values: [...trends.cumCost, null] },
            { name: 'Forecast final', color: RED, values: [...trends.cumCost.slice(0, -1), null, t.forecastFinalCost], dashed: true },
          ]}
        />
        <BarChart
          title="Monthly delivered tonnage"
          sub="Physical reinforcement delivered to site"
          labels={labels.slice(0, trends.months.length)}
          format={(v) => `${v.toFixed(0)}t`}
          series={[{ name: 'Delivered t', color: NAVY, values: trends.monthlyDelivered }]}
        />
        <BarChart
          title="Monthly cost"
          sub="External reinforcement cost received (by cost date)"
          labels={labels.slice(0, trends.months.length)}
          format={(v) => fmtGbpCompact(v)}
          series={[{ name: 'Actual cost', color: GREEN, values: trends.monthlyCost }]}
        />
        <LineChart
          title="£/tonne"
          sub="Budget rate vs actual rate by month"
          labels={labels.slice(0, trends.months.length)}
          format={(v) => `£${v.toFixed(0)}`}
          yMin={Math.max(0, trends.budgetRate * 0.7)}
          series={[
            { name: 'Budget rate', color: STEEL, values: trends.budgetRateLine, dashed: true },
            { name: 'Actual rate', color: AMBER, values: trends.monthlyActualRate },
          ]}
        />
        <BarChart
          title="Forecast"
          sub="Original budget final cost vs current forecast final cost"
          labels={['Budget final', 'Forecast final']}
          format={(v) => fmtGbpCompact(v)}
          series={[
            {
              name: '£', color: NAVY,
              values: [t.budgetValue, null],
            },
            {
              name: '£ fc', color: t.costVariance > 0 ? RED : GREEN,
              values: [null, t.forecastFinalCost],
            },
          ]}
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="Exceptions requiring attention" sub="Click through to the Exceptions screen">
          {openExceptions.length === 0 ? (
            <div className="empty">No open exceptions — everything is costed and reconciled.</div>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Exception</th><th className="num">Records</th><th className="num">Tonnes</th><th className="num">Value</th></tr>
              </thead>
              <tbody>
                {openExceptions.map((e) => (
                  <tr key={e.kind}>
                    <td>
                      {e.label}
                      <div className="cell-sub">{e.description}</div>
                    </td>
                    <td className="num">{e.count}</td>
                    <td className="num">{fmtTonnes(e.tonnes)}</td>
                    <td className="num">{fmtGbp(e.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Commercial validation" sub="Continuous checks on the quantity identities">
          {data.issues.length === 0 ? (
            <div className="empty">
              <span className="identity-ok">✓ Budget = Costed + Accrued + Remaining</span> — all groups reconcile.
            </div>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="data">
                <tbody>
                  {data.issues.slice(0, 30).map((i) => (
                    <tr key={i.id}>
                      <td style={{ width: 90 }}>
                        <span className={`badge ${i.severity === 'error' ? 'b-duplicate' : 'b-uncosted'}`}>
                          {i.severity}
                        </span>
                      </td>
                      <td>{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Recent commercial activity" sub="Audit trail — latest actions affecting commercial data">
        <table className="data">
          <thead>
            <tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Field</th><th>Original</th><th>New</th></tr>
          </thead>
          <tbody>
            {data.audit.slice(0, 8).map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.timestamp.slice(0, 16).replace('T', ' ')}</td>
                <td>{a.user}</td>
                <td><span className="badge b-flat">{a.action}</span></td>
                <td>{a.entity}</td>
                <td>{a.field}</td>
                <td className="mono">{a.originalValue || '—'}</td>
                <td className="mono">{a.newValue || '—'}</td>
              </tr>
            ))}
            {data.audit.length === 0 && (
              <tr><td colSpan={7}><div className="empty">No recorded changes yet</div></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export { monthLabel };
