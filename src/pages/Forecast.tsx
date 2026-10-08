/**
 * Forecast module. Accrued cost = uncosted tonnes × forecast rate;
 * Forecast remaining = remaining tonnes × forecast rate;
 * Forecast final = actual + accrued + remaining forecast (§28).
 * Method is clearly identified at project and schedule level.
 */
import { useState } from 'react';
import type { CommercialLine, ForecastMethod } from '../lib/types';
import { FORECAST_METHOD_LABEL } from '../lib/types';
import { useProjectData } from '../lib/selectors';
import { setForecast, useDb } from '../lib/store';
import { fmtGbp, fmtGbpSigned, fmtRate, fmtTonnes, fmtPctSigned, varianceClass } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Field, Kpi, Modal } from '../components/ui';

const METHODS: { m: ForecastMethod; desc: string }[] = [
  { m: 'budget', desc: 'Use the original budget £/tonne for accrued and remaining tonnes.' },
  { m: 'actual', desc: 'Use the current actual costed £/tonne — reflects rates achieved to date.' },
  { m: 'manual', desc: 'Enter a forecast £/tonne — e.g. a negotiated rate or supplier commitment.' },
];

export function ForecastPage() {
  const data = useProjectData();
  const db = useDb();
  const projectId = db.currentProjectId ?? '';
  const t = data.totals;
  const [editKey, setEditKey] = useState<string | null>(null);

  const setMethod = (m: ForecastMethod) => setForecast(projectId, { method: m, scheduleOverrides: data.forecast.scheduleOverrides });

  const columns: Column<CommercialLine>[] = [
    { key: 'key', header: 'Schedule', render: (l) => <strong className="mono">{l.key}</strong>, sortValue: (l) => l.key },
    { key: 'br', header: 'Budget £/t', align: 'right', kind: 'rate', render: (l) => fmtRate(l.budgetRate), sortValue: (l) => l.budgetRate, exportValue: (l) => l.budgetRate },
    { key: 'ar', header: 'Actual £/t', align: 'right', kind: 'rate', render: (l) => (l.costedTonnes > 0 ? fmtRate(l.actualRate, 2) : '—'), sortValue: (l) => l.actualRate, exportValue: (l) => (l.costedTonnes > 0 ? l.actualRate : null) },
    {
      key: 'method', header: 'Method', render: (l) => (
        <span className="badge b-flat" title={l.forecastRateSource}>
          {FORECAST_METHOD_LABEL[l.forecastRateMethod]}
          {data.forecast.scheduleOverrides[l.key] ? ' (override)' : ''}
        </span>
      ),
      sortValue: (l) => l.forecastRateMethod,
    },
    { key: 'fr', header: 'Forecast £/t', align: 'right', kind: 'rate', render: (l) => <strong>{fmtRate(l.forecastRate, 2)}</strong>, sortValue: (l) => l.forecastRate, exportValue: (l) => l.forecastRate },
    { key: 'act', header: 'Actual Cost', align: 'right', kind: 'money', render: (l) => fmtGbp(l.actualCost), sortValue: (l) => l.actualCost, exportValue: (l) => l.actualCost },
    { key: 'at', header: 'Accrued t', align: 'right', kind: 'tonnes', render: (l) => fmtTonnes(l.uncostedTonnes), sortValue: (l) => l.uncostedTonnes, exportValue: (l) => l.uncostedTonnes },
    { key: 'ac', header: 'Accrued Cost', align: 'right', kind: 'money', render: (l) => fmtGbp(l.accruedCost), sortValue: (l) => l.accruedCost, exportValue: (l) => l.accruedCost },
    { key: 'rt', header: 'Remaining t', align: 'right', kind: 'tonnes', render: (l) => fmtTonnes(l.remainingTonnes), sortValue: (l) => l.remainingTonnes, exportValue: (l) => l.remainingTonnes },
    { key: 'fc', header: 'Forecast Remaining', align: 'right', kind: 'money', render: (l) => fmtGbp(l.futureCost), sortValue: (l) => l.futureCost, exportValue: (l) => l.futureCost },
    { key: 'ff', header: 'Forecast Final Cost', align: 'right', kind: 'money', render: (l) => <strong>{fmtGbp(l.forecastFinalCost)}</strong>, sortValue: (l) => l.forecastFinalCost, exportValue: (l) => l.forecastFinalCost },
    { key: 'bv', header: 'Budget Value', align: 'right', kind: 'money', render: (l) => fmtGbp(l.budgetValue), sortValue: (l) => l.budgetValue, exportValue: (l) => l.budgetValue },
    {
      key: 'var', header: 'Variance', align: 'right', kind: 'money',
      render: (l) => <span className={`num-${varianceClass(l.costVariance)}`}>{fmtGbpSigned(l.costVariance)} ({fmtPctSigned(l.costVariancePct)})</span>,
      sortValue: (l) => l.costVariance, exportValue: (l) => l.costVariance,
    },
    {
      key: 'act2', header: '', align: 'right',
      render: (l) => (
        <span onClick={(e) => e.stopPropagation()}>
          <button className="btn small" onClick={() => setEditKey(l.key)}>Adjust</button>
        </span>
      ),
    },
  ];

  const editing = data.scheduleLines.find((l) => l.key === editKey);

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <Kpi label="Actual Cost" tone="good" value={fmtGbp(t.actualCost)} sub={`${fmtTonnes(t.costedTonnes)} costed`} />
        <Kpi label="Accrued Cost" tone="warn" value={fmtGbp(t.accruedCost)} sub={`${fmtTonnes(t.uncostedTonnes)} delivered, uncosted`} />
        <Kpi label="Forecast Remaining" value={fmtGbp(t.futureCost)} sub={`${fmtTonnes(t.remainingTonnes)} still to deliver`} />
        <Kpi label="Forecast Final Cost" value={fmtGbp(t.forecastFinalCost)} sub={`${fmtRate(t.forecastRate, 2)} forecast £/t`} />
        <Kpi label="Budget Value" value={fmtGbp(t.budgetValue)} sub={`${fmtRate(t.budgetRate)} budget £/t`} />
        <Kpi
          label="Forecast Variance" tone={t.costVariance > 0 ? 'bad' : 'good'}
          value={<span className={`num-${varianceClass(t.costVariance)}`}>{fmtGbpSigned(t.costVariance)}</span>}
          sub={<span className={`num-${varianceClass(t.costVariance)}`}>{fmtPctSigned(t.costVariancePct)}</span>}
        />
      </div>

      <Card title="Forecast rate method" sub="Applies to accrued (delivered, uncosted) and remaining (future) tonnes">
        <div className="card-body">
          <div className="grid cols-3">
            {METHODS.map(({ m, desc }) => {
              const active = data.forecast.method === m;
              return (
                <div
                  key={m}
                  className="card"
                  style={{
                    cursor: 'pointer',
                    borderColor: active ? 'var(--navy)' : 'var(--line)',
                    boxShadow: active ? '0 0 0 2px #c8d8ef' : 'var(--shadow)',
                  }}
                  onClick={() => setMethod(m)}
                >
                  <div className="card-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="radio" readOnly checked={active} />
                      <strong>{FORECAST_METHOD_LABEL[m]}</strong>
                      {active && <span className="pill" style={{ marginLeft: 'auto' }}>In use</span>}
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>{desc}</div>
                    {m === 'actual' && (
                      <div style={{ marginTop: 6 }}>Current actual rate: <strong>{fmtRate(t.costedTonnes > 0 ? t.actualRate : null, 2)}</strong></div>
                    )}
                    {m === 'budget' && (
                      <div style={{ marginTop: 6 }}>Weighted budget rate: <strong>{fmtRate(t.budgetRate)}</strong></div>
                    )}
                    {m === 'manual' && (
                      <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <Field label="Manual forecast rate (£/t)">
                          <input
                            type="number"
                            step="1"
                            value={data.forecast.manualRate ?? ''}
                            onChange={(e) =>
                              setForecast(projectId, { manualRate: e.target.value === '' ? null : Number(e.target.value) })
                            }
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ marginTop: 14 }}>
            Forecast final cost = Actual cost + Accrued cost (uncosted t × forecast rate) + Forecast remaining cost
            (remaining t × forecast rate). Accrued tonnes are <strong>delivered but not yet costed</strong> — never
            treated as future quantity. Per-schedule rates and accrual estimates can be adjusted from the table below.
          </div>
        </div>
      </Card>

      <Card title="Forecast by schedule" sub="Schedule-level forecast with rate method and adjustments">
        <DataTable
          columns={columns}
          rows={data.scheduleLines}
          rowKey={(l) => l.key}
          onRowClick={(l) => setEditKey(l.key)}
          searchFields={(l) => l.key}
          exportName="Rebar-Forecast.xls"
          exportTitle="Reinforcement Forecast"
          footer={
            <tr>
              <td>Total</td>
              <td className="num">{fmtRate(t.budgetRate)}</td>
              <td className="num">{t.costedTonnes > 0 ? fmtRate(t.actualRate, 2) : '—'}</td>
              <td />
              <td className="num">{fmtRate(t.forecastRate, 2)}</td>
              <td className="num">{fmtGbp(t.actualCost)}</td>
              <td className="num">{fmtTonnes(t.uncostedTonnes)}</td>
              <td className="num">{fmtGbp(t.accruedCost)}</td>
              <td className="num">{fmtTonnes(t.remainingTonnes)}</td>
              <td className="num">{fmtGbp(t.futureCost)}</td>
              <td className="num">{fmtGbp(t.forecastFinalCost)}</td>
              <td className="num">{fmtGbp(t.budgetValue)}</td>
              <td className={`num num-${varianceClass(t.costVariance)}`}>{fmtGbpSigned(t.costVariance)}</td>
              <td />
            </tr>
          }
        />
      </Card>

      {editing && (
        <AdjustModal
          line={editing}
          current={{
            method: data.forecast.scheduleOverrides[editing.key]?.method ?? null,
            manualRate: data.forecast.scheduleOverrides[editing.key]?.manualRate ?? null,
            accrual: data.forecast.accrualOverride[editing.key] ?? null,
            forecastTonnes: data.forecast.forecastTonnesOverride[editing.key] ?? null,
          }}
          onClose={() => setEditKey(null)}
          onSave={(v) => {
            const scheduleOverrides = { ...data.forecast.scheduleOverrides };
            const accrualOverride = { ...data.forecast.accrualOverride };
            const forecastTonnesOverride = { ...data.forecast.forecastTonnesOverride };
            if (v.method) scheduleOverrides[editing.key] = { method: v.method, manualRate: v.manualRate };
            else delete scheduleOverrides[editing.key];
            if (v.accrual != null) accrualOverride[editing.key] = v.accrual;
            else delete accrualOverride[editing.key];
            if (v.forecastTonnes != null) forecastTonnesOverride[editing.key] = v.forecastTonnes;
            else delete forecastTonnesOverride[editing.key];
            setForecast(projectId, { scheduleOverrides, accrualOverride, forecastTonnesOverride });
            setEditKey(null);
          }}
        />
      )}
    </>
  );
}

function AdjustModal({
  line, current, onClose, onSave,
}: {
  line: CommercialLine;
  current: { method: ForecastMethod | null; manualRate: number | null; accrual: number | null; forecastTonnes: number | null };
  onClose: () => void;
  onSave: (v: { method: ForecastMethod | null; manualRate: number | null; accrual: number | null; forecastTonnes: number | null }) => void;
}) {
  const [method, setMethod] = useState<ForecastMethod | ''>(current.method ?? '');
  const [manualRate, setManualRate] = useState(String(current.manualRate ?? ''));
  const [accrual, setAccrual] = useState(String(current.accrual ?? ''));
  const [forecastTonnes, setForecastTonnes] = useState(String(current.forecastTonnes ?? ''));

  return (
    <Modal
      title={`Forecast adjustments — ${line.key}`}
      onClose={onClose}
      narrow
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={() =>
              onSave({
                method: (method || null) as ForecastMethod | null,
                manualRate: manualRate === '' ? null : Number(manualRate),
                accrual: accrual === '' ? null : Number(accrual),
                forecastTonnes: forecastTonnes === '' ? null : Number(forecastTonnes),
              })
            }
          >
            Save (audited)
          </button>
        </>
      }
    >
      <div className="muted" style={{ marginBottom: 12 }}>
        Project method: <strong>{FORECAST_METHOD_LABEL[line.forecastRateMethod]}</strong> — rate {fmtRate(line.forecastRate, 2)}.{' '}
        {line.forecastRateSource}
      </div>
      <div className="form-grid cols-2">
        <Field label="Schedule forecast method">
          <select value={method} onChange={(e) => setMethod(e.target.value as ForecastMethod | '')}>
            <option value="">— use project method —</option>
            {METHODS.map(({ m }) => (
              <option key={m} value={m}>{FORECAST_METHOD_LABEL[m]}</option>
            ))}
          </select>
        </Field>
        <Field label="Schedule manual rate (£/t)">
          <input type="number" step="1" value={manualRate} onChange={(e) => setManualRate(e.target.value)} />
        </Field>
        <Field label="Manual accrual estimate (£)">
          <input type="number" step="10" value={accrual} onChange={(e) => setAccrual(e.target.value)} placeholder={`Auto: ${fmtGbp(line.accruedCost)}`} />
        </Field>
        <Field label="Forecast final quantity (t)">
          <input type="number" step="0.1" value={forecastTonnes} onChange={(e) => setForecastTonnes(e.target.value)} placeholder={`Auto: ${fmtTonnes(line.forecastFinalTonnes)}`} />
        </Field>
      </div>
      <div className="muted" style={{ marginTop: 12, fontSize: 11.5 }}>
        Leave a field blank to use the automatic calculation. All adjustments are labelled as manual and logged in
        the audit trail; imported values are never overwritten.
      </div>
    </Modal>
  );
}
