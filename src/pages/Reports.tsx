/** Reinforcement Cost Report (§23) with Excel + PDF (print) export. */
import { useMemo, useState } from 'react';
import { useProjectData } from '../lib/selectors';
import { GROUP_LABEL, type GroupBy } from '../lib/commercial';
import { exportWorkbook, printToPdf, type ExportSheet } from '../lib/exporters';
import {
  fmtDate, fmtGbp, fmtGbpSigned, fmtPct, fmtPctSigned, fmtRate, fmtRateSigned,
  fmtTonnes, varianceClass,
} from '../lib/format';
import { MATCH_STATUS_LABEL } from '../lib/types';
import { Card } from '../components/ui';

export function ReportsPage() {
  const data = useProjectData();
  const t = data.totals;
  const [rateGroup, setRateGroup] = useState<'schedule' | 'location' | 'supplier' | 'month'>('schedule');
  const rateLines = useMemo(() => data.groupLines(rateGroup), [data, rateGroup]);
  const locLines = useMemo(() => data.groupLines('location'), [data]);

  const rateStats = {
    budget: t.budgetRate,
    actual: t.costedTonnes > 0 ? t.actualRate : null,
    forecast: t.forecastRate,
    varRate: t.forecastRate - t.budgetRate,
    varPct: t.budgetRate > 0 ? ((t.forecastRate - t.budgetRate) / t.budgetRate) * 100 : 0,
  };

  const statusSummary = useMemo(() => {
    const m = new Map<string, { count: number; tonnes: number; value: number }>();
    for (const r of data.rows) {
      const s = m.get(r.status) ?? { count: 0, tonnes: 0, value: 0 };
      s.count++;
      s.tonnes += r.deliveredTonnes ?? r.costedTonnes ?? 0;
      s.value += r.cost ?? 0;
      m.set(r.status, s);
    }
    return m;
  }, [data.rows]);

  const fullWorkbook = () => {
    const sheets: ExportSheet[] = [
      summarySheet(),
      scheduleSheet(),
      locationSheet(),
      rateSheet(),
      reconciliationSheet(),
      exceptionsSheet(),
      {
        name: 'Budget', title: 'Reinforcement Budget',
        columns: [
          { header: 'Schedule', kind: 'text', width: 10 },
          { header: 'Location', kind: 'text', width: 14 },
          { header: 'Element', kind: 'text', width: 14 },
          { header: 'Description', kind: 'text', width: 28 },
          { header: 'Budget t', kind: 'tonnes', width: 10 },
          { header: 'Budget £/t', kind: 'rate', width: 11 },
          { header: 'Budget £', kind: 'money', width: 12 },
          { header: 'Supplier', kind: 'text', width: 12 },
          { header: 'Package', kind: 'text', width: 14 },
          { header: 'Phase', kind: 'text', width: 10 },
          { header: 'Area', kind: 'text', width: 10 },
          { header: 'Notes', kind: 'text', width: 22 },
          { header: 'Source', kind: 'text', width: 14 },
        ],
        rows: data.budget.map((b) => [
          b.scheduleRef, b.location, b.element, b.description, b.budgetTonnes,
          b.budgetRate, b.budgetValue, b.supplier, b.package, b.phase, b.area, b.notes, b.source,
        ]),
      },
      {
        name: 'Deliveries', title: 'Delivery Register',
        columns: [
          { header: 'Delivery Date', kind: 'date', width: 12 },
          { header: 'Ticket No', kind: 'text', width: 14 },
          { header: 'Schedule', kind: 'text', width: 10 },
          { header: 'Location', kind: 'text', width: 14 },
          { header: 'Element', kind: 'text', width: 14 },
          { header: 'Tonnes', kind: 'tonnes', width: 10 },
          { header: 'Description', kind: 'text', width: 26 },
          { header: 'Supplier', kind: 'text', width: 12 },
          { header: 'Package', kind: 'text', width: 14 },
          { header: 'Phase', kind: 'text', width: 10 },
          { header: 'Source', kind: 'text', width: 14 },
        ],
        rows: data.deliveries.map((d) => [
          d.deliveryDate, d.ticketNo, d.scheduleRef, d.location, d.element,
          d.tonnes, d.description, d.supplier, d.package, d.phase, d.source,
        ]),
      },
      {
        name: 'Costs', title: 'Cost Register',
        columns: [
          { header: 'Cost Date', kind: 'date', width: 12 },
          { header: 'Ticket No', kind: 'text', width: 14 },
          { header: 'Costed t', kind: 'tonnes', width: 10 },
          { header: 'Cost £', kind: 'money', width: 12 },
          { header: 'Actual £/t', kind: 'rate', width: 11 },
          { header: 'Supplier', kind: 'text', width: 12 },
          { header: 'Cost Reference', kind: 'text', width: 14 },
          { header: 'Source', kind: 'text', width: 14 },
        ],
        rows: data.costs.map((c) => [
          c.costDate, c.ticketNo, c.costedTonnes, c.cost,
          c.costedTonnes > 0 ? c.cost / c.costedTonnes : null,
          c.supplier, c.costRef, c.source,
        ]),
      },
    ];
    exportWorkbook('Rebar-Commercial-Report.xls', sheets, 'Reinforcement Cost Report — Full Data Pack');
  };

  function summarySheet(): ExportSheet {
    return {
      name: 'Summary', title: 'Executive Summary',
      columns: [
        { header: 'Measure', kind: 'text', width: 34 },
        { header: 'Value', kind: 'text', width: 18 },
      ],
      rows: [
        ['Budget tonnes', t.budgetTonnes],
        ['Budget value', t.budgetValue],
        ['Budget rate £/t', t.budgetRate],
        ['Delivered tonnes', t.deliveredTonnes],
        ['Costed tonnes', t.costedTonnes],
        ['Accrued (uncosted) tonnes', t.uncostedTonnes],
        ['Remaining tonnes', t.remainingTonnes],
        ['Actual cost', t.actualCost],
        ['Actual rate £/t', t.costedTonnes > 0 ? t.actualRate : null],
        ['Accrued cost estimate', t.accruedCost],
        ['Forecast remaining cost', t.futureCost],
        ['Forecast final tonnes', t.forecastFinalTonnes],
        ['Forecast final cost', t.forecastFinalCost],
        ['Forecast rate £/t', t.forecastRate],
        ['Forecast variance £', t.costVariance],
        ['Forecast variance %', t.costVariancePct],
      ],
    };
  }

  function scheduleSheet(): ExportSheet {
    return {
      name: 'Schedule Analysis', title: 'Budget vs Actual vs Forecast by Schedule',
      columns: [
        { header: 'Schedule', kind: 'text', width: 10 },
        { header: 'Budget t', kind: 'tonnes', width: 10 },
        { header: 'Delivered t', kind: 'tonnes', width: 11 },
        { header: 'Costed t', kind: 'tonnes', width: 10 },
        { header: 'Accrued t', kind: 'tonnes', width: 10 },
        { header: 'Remaining t', kind: 'tonnes', width: 11 },
        { header: 'Budget £', kind: 'money', width: 12 },
        { header: 'Actual £', kind: 'money', width: 12 },
        { header: 'Accrued £', kind: 'money', width: 12 },
        { header: 'Forecast Remaining £', kind: 'money', width: 16 },
        { header: 'Forecast Final £', kind: 'money', width: 14 },
        { header: 'Variance £', kind: 'money', width: 12 },
        { header: 'Variance %', kind: 'pct', width: 10 },
        { header: 'Budget £/t', kind: 'rate', width: 11 },
        { header: 'Actual £/t', kind: 'rate', width: 11 },
        { header: 'Forecast £/t', kind: 'rate', width: 12 },
      ],
      rows: data.scheduleLines.map((l) => [
        l.key, l.budgetTonnes, l.deliveredTonnes, l.costedTonnes, l.uncostedTonnes, l.remainingTonnes,
        l.budgetValue, l.actualCost, l.accruedCost, l.futureCost, l.forecastFinalCost,
        l.costVariance, l.costVariancePct, l.budgetRate,
        l.costedTonnes > 0 ? l.actualRate : null, l.forecastRate,
      ]),
    };
  }

  function locationSheet(): ExportSheet {
    return {
      name: 'Location Analysis', title: 'Budget vs Actual vs Forecast by Location',
      columns: scheduleSheet().columns.map((c) =>
        c.header === 'Schedule' ? { ...c, header: 'Location' } : c,
      ),
      rows: locLines.map((l) => [
        l.key, l.budgetTonnes, l.deliveredTonnes, l.costedTonnes, l.uncostedTonnes, l.remainingTonnes,
        l.budgetValue, l.actualCost, l.accruedCost, l.futureCost, l.forecastFinalCost,
        l.costVariance, l.costVariancePct, l.budgetRate,
        l.costedTonnes > 0 ? l.actualRate : null, l.forecastRate,
      ]),
    };
  }

  function rateSheet(): ExportSheet {
    return {
      name: 'Rate Analysis', title: `Rate Analysis by ${GROUP_LABEL[rateGroup]}`,
      columns: [
        { header: GROUP_LABEL[rateGroup], kind: 'text', width: 16 },
        { header: 'Budget £/t', kind: 'rate', width: 11 },
        { header: 'Actual £/t', kind: 'rate', width: 11 },
        { header: 'Forecast £/t', kind: 'rate', width: 12 },
        { header: 'Variance £/t', kind: 'rate', width: 12 },
        { header: 'Variance %', kind: 'pct', width: 10 },
        { header: 'Costed t', kind: 'tonnes', width: 10 },
        { header: 'Review flag', kind: 'text', width: 16 },
      ],
      rows: rateLines.map((l) => [
        l.key, l.budgetRate, l.costedTonnes > 0 ? l.actualRate : null, l.forecastRate,
        l.rateVariance, l.rateVariancePct, l.costedTonnes, rateFlag(l.rateVariancePct),
      ]),
    };
  }

  function reconciliationSheet(): ExportSheet {
    return {
      name: 'Reconciliation', title: 'Delivery vs Costed Tickets',
      columns: [
        { header: 'Delivery Date', kind: 'date', width: 12 },
        { header: 'Ticket No', kind: 'text', width: 14 },
        { header: 'Schedule', kind: 'text', width: 10 },
        { header: 'Location', kind: 'text', width: 14 },
        { header: 'Delivered t', kind: 'tonnes', width: 11 },
        { header: 'Cost Date', kind: 'date', width: 12 },
        { header: 'Costed t', kind: 'tonnes', width: 10 },
        { header: 'Cost £', kind: 'money', width: 12 },
        { header: 'Actual £/t', kind: 'rate', width: 11 },
        { header: 'Tonnage Var', kind: 'tonnes', width: 11 },
        { header: 'Status', kind: 'text', width: 20 },
        { header: 'Cost Reference', kind: 'text', width: 14 },
      ],
      rows: data.rows.map((r) => [
        r.deliveryDate, r.ticketNo, r.scheduleRef, r.location, r.deliveredTonnes,
        r.costDate, r.costedTonnes, r.cost, r.actualRate, r.tonnageVariance,
        MATCH_STATUS_LABEL[r.status], r.costRef,
      ]),
    };
  }

  function exceptionsSheet(): ExportSheet {
    return {
      name: 'Exceptions', title: 'Outstanding Unmatched or Abnormal Records',
      columns: [
        { header: 'Exception', kind: 'text', width: 26 },
        { header: 'Description', kind: 'text', width: 40 },
        { header: 'Records', kind: 'num', width: 9 },
        { header: 'Tonnes', kind: 'tonnes', width: 10 },
        { header: 'Value £', kind: 'money', width: 12 },
      ],
      rows: data.exceptions.map((e) => [e.label, e.description, e.count, e.tonnes, e.value]),
    };
  }

  const rateFlag = (varPct: number): string =>
    varPct > 15 ? 'High rate — review' : varPct < -15 ? 'Low rate — review' : 'Within range';

  return (
    <>
      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className="btn primary" onClick={fullWorkbook}>
          ⬇ Export full report workbook (Excel)
        </button>
        <button className="btn" onClick={() => exportWorkbook('Rebar-Cost-Report.xls', [summarySheet(), scheduleSheet(), locationSheet(), rateSheet(), reconciliationSheet(), exceptionsSheet()], 'Reinforcement Cost Report')}>
          ⬇ Report sections only
        </button>
        <button className="btn" onClick={printToPdf}>⎙ Export PDF (Print)</button>
        <span className="muted" style={{ alignSelf: 'center' }}>
          PDF: choose “Save as PDF” in the print dialog
        </span>
      </div>

      <div className="report">
        <h1>Reinforcement Cost Report</h1>
        <div className="report-meta">
          {data.project?.name} · {data.project?.number} · Client: {data.project?.client} · Main
          contractor: {data.project?.mainContractor} · Report date: {fmtDate(new Date().toISOString())} · Prepared
          for commercial review
        </div>

        <h2>Executive Summary</h2>
        <table className="data">
          <tbody>
            <tr>
              <td>Budget</td><td className="num">{fmtTonnes(t.budgetTonnes)}</td>
              <td className="num">{fmtGbp(t.budgetValue)}</td><td className="num">{fmtRate(t.budgetRate)}</td>
            </tr>
            <tr>
              <td>Delivered</td><td className="num">{fmtTonnes(t.deliveredTonnes)}</td>
              <td className="num">{fmtPct(t.budgetTonnes ? (t.deliveredTonnes / t.budgetTonnes) * 100 : 0)} of budget</td><td />
            </tr>
            <tr>
              <td>Costed</td><td className="num">{fmtTonnes(t.costedTonnes)}</td>
              <td className="num">{fmtGbp(t.actualCost)}</td><td className="num">{fmtRate(t.actualRate, 2)}</td>
            </tr>
            <tr>
              <td>Accrued (delivered, uncosted)</td><td className="num">{fmtTonnes(t.uncostedTonnes)}</td>
              <td className="num">{fmtGbp(t.accruedCost)}</td><td className="num">{fmtRate(t.forecastRate, 2)}</td>
            </tr>
            <tr>
              <td>Remaining</td><td className="num">{fmtTonnes(t.remainingTonnes)}</td>
              <td className="num">{fmtGbp(t.futureCost)}</td><td />
            </tr>
            <tr>
              <td><strong>Forecast final</strong></td>
              <td className="num"><strong>{fmtTonnes(t.forecastFinalTonnes)}</strong></td>
              <td className="num"><strong>{fmtGbp(t.forecastFinalCost)}</strong></td>
              <td className="num"><strong>{fmtRate(t.forecastRate, 2)}</strong></td>
            </tr>
            <tr>
              <td>Forecast variance</td>
              <td className={`num num-${varianceClass(t.costVariance)}`}>{fmtGbpSigned(t.costVariance)}</td>
              <td className={`num num-${varianceClass(t.costVariance)}`}>{fmtPctSigned(t.costVariancePct)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <p className="report-meta">
          Quantity identity: Budget = Costed + Accrued + Remaining —{' '}
          {data.issues.filter((i) => i.kind === 'QUANTITY_IDENTITY').length === 0
            ? 'validated ✓'
            : 'DISCREPANCIES PRESENT — see exceptions'}
          . Forecast method: {FORECAST_LABEL(data.forecast.method)}.
        </p>

        <h2>Schedule Analysis</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Schedule</th><th className="num">Budget t</th><th className="num">Delivered t</th>
              <th className="num">Costed t</th><th className="num">Accrued t</th><th className="num">Remaining t</th>
              <th className="num">Budget £</th><th className="num">Actual £</th><th className="num">Forecast £</th>
              <th className="num">Variance £</th><th className="num">Actual £/t</th>
            </tr>
          </thead>
          <tbody>
            {data.scheduleLines.map((l) => (
              <tr key={l.key}>
                <td>{l.key}</td>
                <td className="num">{fmtTonnes(l.budgetTonnes)}</td>
                <td className="num">{fmtTonnes(l.deliveredTonnes)}</td>
                <td className="num">{fmtTonnes(l.costedTonnes)}</td>
                <td className="num">{fmtTonnes(l.uncostedTonnes)}</td>
                <td className="num">{fmtTonnes(l.remainingTonnes)}</td>
                <td className="num">{fmtGbp(l.budgetValue)}</td>
                <td className="num">{fmtGbp(l.actualCost)}</td>
                <td className="num">{fmtGbp(l.forecastFinalCost)}</td>
                <td className={`num num-${varianceClass(l.costVariance)}`}>{fmtGbpSigned(l.costVariance)}</td>
                <td className="num">{l.costedTonnes > 0 ? fmtRate(l.actualRate, 2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="page-break">Location Analysis</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Location</th><th className="num">Budget t</th><th className="num">Delivered t</th>
              <th className="num">Costed t</th><th className="num">Accrued t</th><th className="num">Remaining t</th>
              <th className="num">Budget £</th><th className="num">Actual £</th><th className="num">Forecast £</th>
              <th className="num">Variance £</th>
            </tr>
          </thead>
          <tbody>
            {locLines.map((l) => (
              <tr key={l.key}>
                <td>{l.key}</td>
                <td className="num">{fmtTonnes(l.budgetTonnes)}</td>
                <td className="num">{fmtTonnes(l.deliveredTonnes)}</td>
                <td className="num">{fmtTonnes(l.costedTonnes)}</td>
                <td className="num">{fmtTonnes(l.uncostedTonnes)}</td>
                <td className="num">{fmtTonnes(l.remainingTonnes)}</td>
                <td className="num">{fmtGbp(l.budgetValue)}</td>
                <td className="num">{fmtGbp(l.actualCost)}</td>
                <td className="num">{fmtGbp(l.forecastFinalCost)}</td>
                <td className={`num num-${varianceClass(l.costVariance)}`}>{fmtGbpSigned(l.costVariance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Rate Analysis</h2>
        <div className="stat-row" style={{ marginBottom: 10 }}>
          <div className="stat"><div className="stat-label">Budget average £/t</div><div className="stat-value">{fmtRate(rateStats.budget)}</div></div>
          <div className="stat"><div className="stat-label">Actual average £/t</div><div className="stat-value">{rateStats.actual != null ? fmtRate(rateStats.actual, 2) : '—'}</div></div>
          <div className="stat"><div className="stat-label">Forecast average £/t</div><div className="stat-value">{fmtRate(rateStats.forecast, 2)}</div></div>
          <div className="stat">
            <div className="stat-label">Variance £/t</div>
            <div className={`stat-value num-${varianceClass(rateStats.varRate)}`}>{fmtRateSigned(rateStats.varRate, 2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Variance %</div>
            <div className={`stat-value num-${varianceClass(rateStats.varRate)}`}>{fmtPctSigned(rateStats.varPct)}</div>
          </div>
          <div className="no-print" style={{ alignSelf: 'center' }}>
            <select className="txt" value={rateGroup} onChange={(e) => setRateGroup(e.target.value as 'schedule')}>
              <option value="schedule">By schedule</option>
              <option value="location">By location</option>
              <option value="supplier">By supplier</option>
              <option value="month">By month</option>
            </select>
          </div>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>{GROUP_LABEL[rateGroup as GroupBy]}</th><th className="num">Budget £/t</th>
              <th className="num">Actual £/t</th><th className="num">Forecast £/t</th>
              <th className="num">Var £/t</th><th className="num">Var %</th><th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rateLines.map((l) => (
              <tr key={l.key}>
                <td>{l.key}</td>
                <td className="num">{fmtRate(l.budgetRate)}</td>
                <td className="num">{l.costedTonnes > 0 ? fmtRate(l.actualRate, 2) : '—'}</td>
                <td className="num">{fmtRate(l.forecastRate, 2)}</td>
                <td className={`num num-${varianceClass(l.rateVariance)}`}>{fmtRateSigned(l.rateVariance, 2)}</td>
                <td className={`num num-${varianceClass(l.rateVariance)}`}>{fmtPctSigned(l.rateVariancePct)}</td>
                <td>{rateFlag(l.rateVariancePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="report-meta">
          Rates flagged for review only — a flagged rate is not classified as incorrect.
        </p>

        <h2 className="page-break">Reconciliation</h2>
        <table className="data">
          <thead>
            <tr><th>Status</th><th className="num">Records</th><th className="num">Tonnes</th><th className="num">Value £</th></tr>
          </thead>
          <tbody>
            {[...statusSummary.entries()].map(([s, v]) => (
              <tr key={s}>
                <td>{MATCH_STATUS_LABEL[s as keyof typeof MATCH_STATUS_LABEL]}</td>
                <td className="num">{v.count}</td>
                <td className="num">{fmtTonnes(v.tonnes, 2)}</td>
                <td className="num">{fmtGbp(v.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Exceptions</h2>
        <table className="data">
          <thead>
            <tr><th>Exception</th><th>Description</th><th className="num">Records</th><th className="num">Tonnes</th><th className="num">Value £</th></tr>
          </thead>
          <tbody>
            {data.exceptions.filter((e) => e.count > 0).map((e) => (
              <tr key={e.kind}>
                <td>{e.label}</td>
                <td>{e.description}</td>
                <td className="num">{e.count}</td>
                <td className="num">{fmtTonnes(e.tonnes, 2)}</td>
                <td className="num">{fmtGbp(e.value)}</td>
              </tr>
            ))}
            {data.exceptions.every((e) => e.count === 0) && (
              <tr><td colSpan={5}>No outstanding exceptions.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FORECAST_LABEL(m: string): string {
  return m === 'budget' ? 'Budget rate' : m === 'manual' ? 'Manual forecast rate' : 'Current actual rate';
}
