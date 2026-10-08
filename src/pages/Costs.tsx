/** Cost Register — external cost data from the procurement/commercial system. */
import { useMemo, useState } from 'react';
import type { CostRecord, MatchStatus } from '../lib/types';
import { useProjectData } from '../lib/selectors';
import { addCosts, deleteCost, updateCost, useDb } from '../lib/store';
import { fmtDate, fmtGbp, fmtRate, fmtTonnes } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Field, Kpi, Modal, SourceBadge, StatusBadge } from '../components/ui';
import { FilterControls, dateOk, emptyFilters, optOk, textOk, uniqueSorted, type TableFilters } from '../components/Filters';
import { ImportWizard } from '../components/ImportWizard';

const BLANK = {
  costDate: '', ticketNo: '', costedTonnes: '', cost: '', supplier: '', costRef: '',
};

const ALL_STATUSES: MatchStatus[] = [
  'COSTED', 'TONNAGE_MISMATCH', 'COST_NO_DELIVERY', 'DUPLICATE', 'MATCH_REVIEW',
];

export function CostsPage() {
  const data = useProjectData();
  const db = useDb();
  const projectId = db.currentProjectId ?? '';
  const [f, setF] = useState<TableFilters>(emptyFilters());
  const set = (patch: Partial<TableFilters>) => setF((x) => ({ ...x, ...patch }));
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; form: typeof BLANK } | null>(null);
  // Inline quick-add row — type across the fields, Enter commits, row clears for next entry.
  const [qa, setQa] = useState<typeof BLANK>({ ...BLANK });
  const qHasData = qa.costDate || qa.ticketNo.trim() || (qa.costedTonnes as unknown as boolean) ||
    (qa.cost as unknown as boolean) || qa.supplier.trim() || qa.costRef.trim();
  const commitQa = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    if (!qa.ticketNo.trim() || !(Number(qa.costedTonnes) || 0) || !(Number(qa.cost) || 0)) return;
    addCosts([{
      projectId,
      costDate: qa.costDate,
      ticketNo: qa.ticketNo.trim(),
      costedTonnes: Number(qa.costedTonnes) || 0,
      cost: Number(qa.cost) || 0,
      supplier: qa.supplier.trim(),
      costRef: qa.costRef.trim(),
      source: 'manual',
      raw: {},
    }]);
    setQa({ ...BLANK });
  };

  const statusByCost = useMemo(() => {
    const m = new Map<string, MatchStatus>();
    for (const r of data.rows) if (r.costId) m.set(r.costId, r.status);
    return m;
  }, [data.rows]);

  const rows = useMemo(
    () =>
      data.costs.filter((c) => {
        const st = statusByCost.get(c.id);
        return (
          dateOk(c.costDate, f) &&
          optOk(c.supplier, f.supplier) &&
          (!f.status || st === f.status) &&
          (!f.ticket || c.ticketNo.toLowerCase().includes(f.ticket.toLowerCase())) &&
          textOk([c.ticketNo, c.costRef, c.supplier], f)
        );
      }),
    [data.costs, statusByCost, f],
  );
  const totalCost = rows.reduce((a, c) => a + c.cost, 0);
  const totalTonnes = rows.reduce((a, c) => a + c.costedTonnes, 0);

  const columns: Column<CostRecord>[] = [
    { key: 'date', header: 'Cost Date', kind: 'date', render: (c) => fmtDate(c.costDate), sortValue: (c) => c.costDate, exportValue: (c) => c.costDate },
    { key: 'ticket', header: 'Ticket No', render: (c) => <span className="mono">{c.ticketNo || <em className="num-bad">(missing)</em>}</span>, sortValue: (c) => c.ticketNo },
    { key: 'ct', header: 'Costed t', align: 'right', kind: 'tonnes', render: (c) => fmtTonnes(c.costedTonnes, 2), sortValue: (c) => c.costedTonnes, exportValue: (c) => c.costedTonnes },
    { key: 'cost', header: 'Cost £', align: 'right', kind: 'money', render: (c) => <strong>{fmtGbp(c.cost)}</strong>, sortValue: (c) => c.cost, exportValue: (c) => c.cost },
    {
      key: 'rate', header: 'Actual £/t', align: 'right', kind: 'rate',
      render: (c) => fmtRate(c.costedTonnes > 0 ? c.cost / c.costedTonnes : null, 2),
      sortValue: (c) => (c.costedTonnes > 0 ? c.cost / c.costedTonnes : 0),
      exportValue: (c) => (c.costedTonnes > 0 ? c.cost / c.costedTonnes : null),
    },
    { key: 'sup', header: 'Supplier', render: (c) => c.supplier || '—', sortValue: (c) => c.supplier },
    { key: 'ref', header: 'Cost Reference', render: (c) => <span className="mono">{c.costRef || '—'}</span>, sortValue: (c) => c.costRef },
    {
      key: 'status', header: 'Status', render: (c) => {
        const st = statusByCost.get(c.id);
        return st ? <StatusBadge status={st} /> : <span className="badge b-flat">—</span>;
      },
      sortValue: (c) => statusByCost.get(c.id) ?? '',
    },
    { key: 'src', header: 'Source', render: (c) => <SourceBadge source={c.source} />, sortValue: (c) => c.source },
    {
      key: 'act', header: '', align: 'right',
      render: (c) => (
        <span onClick={(e) => e.stopPropagation()}>
          <button
            className="btn small"
            onClick={() =>
              setEditing({
                id: c.id,
                form: {
                  costDate: c.costDate, ticketNo: c.ticketNo, costedTonnes: String(c.costedTonnes),
                  cost: String(c.cost), supplier: c.supplier, costRef: c.costRef,
                },
              })
            }
          >
            Edit
          </button>{' '}
          <button className="btn small danger" onClick={() => confirm(`Delete cost record ${c.costRef || c.ticketNo}?`) && deleteCost(c.id)}>
            Del
          </button>
        </span>
      ),
    },
  ];

  const save = () => {
    if (!editing) return;
    const { form } = editing;
    const payload = {
      costDate: form.costDate,
      ticketNo: form.ticketNo.trim(),
      costedTonnes: Number(form.costedTonnes) || 0,
      cost: Number(form.cost) || 0,
      supplier: form.supplier.trim(),
      costRef: form.costRef.trim(),
    };
    if (editing.id) updateCost(editing.id, payload);
    else addCosts([{ ...payload, projectId, source: 'manual', raw: {} }]);
    setEditing(null);
  };

  const edited = editing?.id ? data.costs.find((c) => c.id === editing.id) : null;

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Cost Records" value={rows.length} sub={`${data.costs.length} in project`} />
        <Kpi label="Costed Tonnes" value={fmtTonnes(totalTonnes, 2)} />
        <Kpi label="Actual Cost" value={fmtGbp(totalCost)} tone="good" />
        <Kpi label="Actual Rate" value={fmtRate(totalTonnes ? totalCost / totalTonnes : null)} sub="Cost ÷ costed tonnes" />
      </div>

      <Card title="Cost register" sub="External cost data — original imported values retained">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          searchFields={(c) => `${c.ticketNo} ${c.costRef} ${c.supplier}`}
          searchPlaceholder="Search ticket, cost reference…"
          exportName="Rebar-Costs.xls"
          exportTitle="Cost Register"
          emptyText="No cost records yet — import the external cost extract"
          toolbar={
            <FilterControls
              f={f}
              set={set}
              schedules={undefined}
              suppliers={uniqueSorted(data.costs.map((c) => c.supplier))}
              statuses={ALL_STATUSES}
            />
          }
          quickAddCells={[
            <input
              key="qa-date"
              className="qadd-in"
              type="date"
              value={qa.costDate}
              onChange={(e) => setQa({ ...qa, costDate: e.target.value })}
              onKeyDown={commitQa}
            />,
            <input
              key="qa-ticket"
              className="qadd-in mono"
              value={qa.ticketNo}
              onChange={(e) => setQa({ ...qa, ticketNo: e.target.value })}
              placeholder="Ticket *"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-ct"
              className="qadd-in num"
              type="number"
              step="0.01"
              value={qa.costedTonnes}
              onChange={(e) => setQa({ ...qa, costedTonnes: e.target.value })}
              placeholder="t *"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-cost"
              className="qadd-in num"
              type="number"
              step="0.01"
              value={qa.cost}
              onChange={(e) => setQa({ ...qa, cost: e.target.value })}
              placeholder="Cost £ *"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-rate"
              className="qadd-in num"
              value={qa.costedTonnes && qa.cost ? fmtRate((Number(qa.cost) / Number(qa.costedTonnes)) || 0, 2) : ''}
              readOnly
            />,
            <input
              key="qa-sup"
              className="qadd-in"
              value={qa.supplier}
              onChange={(e) => setQa({ ...qa, supplier: e.target.value })}
              placeholder="Supplier"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-ref"
              className="qadd-in mono"
              value={qa.costRef}
              onChange={(e) => setQa({ ...qa, costRef: e.target.value })}
              placeholder="Cost Ref"
              onKeyDown={commitQa}
            />,
            <span key="qa-status" className="cell-sub">—</span>,
            <span key="qa-src" className="cell-sub">Manual</span>,
            <span key="qa-act" />,
          ]}
          right={
            <>
              <button className="btn" onClick={() => setImporting(true)}>⬆ Import</button>
              <button className="btn primary" onClick={() => setEditing({ id: null, form: { ...BLANK } })}>
                + Add cost record
              </button>
            </>
          }
          footer={
            <tr>
              <td colSpan={2}>Total</td>
              <td className="num">{fmtTonnes(totalTonnes, 2)}</td>
              <td className="num">{fmtGbp(totalCost)}</td>
              <td className="num">{fmtRate(totalTonnes ? totalCost / totalTonnes : null, 2)}</td>
              <td colSpan={5} />
            </tr>
          }
        />
      </Card>

      {importing && <ImportWizard type="cost" onClose={() => setImporting(false)} />}

      {editing && (
        <Modal
          title={editing.id ? `Edit cost record — ${edited?.costRef || edited?.ticketNo || ''}` : 'Add cost record'}
          onClose={() => setEditing(null)}
          narrow
          footer={
            <>
              {edited && <SourceBadge source={edited.source} />}
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save}>
                {editing.id ? 'Save adjustment (audited)' : 'Add cost record'}
              </button>
            </>
          }
        >
          {edited && edited.importedCost != null && edited.importedCost !== edited.cost && (
            <div className="pill b-imported" style={{ marginBottom: 12 }}>
              Original imported value retained — £{edited.importedCost.toLocaleString('en-GB')}
            </div>
          )}
          <div className="form-grid cols-2">
            <Field label="Cost Date">
              <input type="date" value={editing.form.costDate} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, costDate: e.target.value } })} />
            </Field>
            <Field label="Delivery Ticket No">
              <input value={editing.form.ticketNo} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, ticketNo: e.target.value } })} />
            </Field>
            <Field label="Costed Tonnes">
              <input type="number" step="0.01" value={editing.form.costedTonnes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, costedTonnes: e.target.value } })} />
            </Field>
            <Field label="Cost £">
              <input type="number" step="0.01" value={editing.form.cost} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, cost: e.target.value } })} />
            </Field>
            <Field label="Supplier">
              <input value={editing.form.supplier} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, supplier: e.target.value } })} />
            </Field>
            <Field label="Cost Reference">
              <input value={editing.form.costRef} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, costRef: e.target.value } })} />
            </Field>
          </div>
          <div className="stat-row" style={{ marginTop: 14 }}>
            <div className="stat">
              <div className="stat-label">Actual £/tonne (calculated)</div>
              <div className="stat-value">
                {fmtRate(
                  Number(editing.form.costedTonnes) > 0
                    ? (Number(editing.form.cost) || 0) / Number(editing.form.costedTonnes)
                    : null,
                  2,
                )}
              </div>
            </div>
          </div>
          {edited && Object.keys(edited.raw ?? {}).length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Original imported row (retained verbatim)</summary>
              <table className="data" style={{ marginTop: 8 }}>
                <tbody>
                  {Object.entries(edited.raw).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td className="mono">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </Modal>
      )}
    </>
  );
}
