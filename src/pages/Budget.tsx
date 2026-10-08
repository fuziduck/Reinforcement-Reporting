/** Reinforcement Budget module — allowance register, edits are audited. */
import { useMemo, useState } from 'react';
import type { BudgetLine } from '../lib/types';
import { useProjectData } from '../lib/selectors';
import { addBudgetLines, deleteBudgetLine, updateBudgetLine, useDb } from '../lib/store';
import { fmtGbp, fmtRate, fmtTonnes } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Field, Kpi, Modal, SourceBadge } from '../components/ui';
import { FilterControls, emptyFilters, optOk, textOk, uniqueSorted, type TableFilters } from '../components/Filters';
import { ImportWizard } from '../components/ImportWizard';

const BLANK = {
  scheduleRef: '', location: '', element: '', description: '',
  budgetTonnes: '', budgetRate: '', supplier: '', package: '', phase: '', area: '', notes: '',
};

export function BudgetPage() {
  const data = useProjectData();
  const db = useDb();
  const projectId = db.currentProjectId ?? '';
  const [f, setF] = useState<TableFilters>(emptyFilters());
  const set = (patch: Partial<TableFilters>) => setF((x) => ({ ...x, ...patch }));
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; form: typeof BLANK } | null>(null);
  // Inline quick-add row — type across the fields, Enter commits, row clears for next entry.
  const [qa, setQa] = useState<typeof BLANK>({ ...BLANK });
  const qRows = qa.scheduleRef.trim() || qa.location.trim() || qa.element.trim() ||
    qa.description.trim() || (qa.budgetTonnes as unknown as boolean) || (qa.budgetRate as unknown as boolean) ||
    qa.supplier.trim() || qa.package.trim() || qa.phase.trim() || qa.area.trim() || qa.notes.trim();
  const commitQa = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    const t = Number(qa.budgetTonnes) || 0;
    const r = Number(qa.budgetRate) || 0;
    if (!qa.scheduleRef.trim() || !t || !r) return;
    addBudgetLines([{
      projectId,
      scheduleRef: qa.scheduleRef.trim(),
      location: qa.location.trim(),
      element: qa.element.trim(),
      description: qa.description.trim(),
      budgetTonnes: t,
      budgetRate: r,
      supplier: qa.supplier.trim(),
      package: qa.package.trim(),
      phase: qa.phase.trim(),
      area: qa.area.trim(),
      notes: qa.notes.trim(),
      source: 'manual',
    }]);
    setQa({ ...BLANK });
  };

  const rows = useMemo(
    () =>
      data.budget.filter(
        (b) =>
          optOk(b.scheduleRef, f.schedule) &&
          optOk(b.location, f.location) &&
          optOk(b.supplier, f.supplier) &&
          textOk([b.scheduleRef, b.location, b.element, b.description, b.supplier, b.package, b.phase, b.notes], f),
      ),
    [data.budget, f],
  );
  const totals = rows.reduce(
    (a, b) => ({ t: a.t + b.budgetTonnes, v: a.v + b.budgetValue }),
    { t: 0, v: 0 },
  );

  const columns: Column<BudgetLine>[] = [
    { key: 'sched', header: 'Schedule', render: (b) => <strong className="mono">{b.scheduleRef}</strong>, sortValue: (b) => b.scheduleRef },
    { key: 'loc', header: 'Location', render: (b) => b.location || '—', sortValue: (b) => b.location },
    { key: 'elem', header: 'Element', render: (b) => b.element || '—', sortValue: (b) => b.element },
    { key: 'desc', header: 'Description', render: (b) => b.description || '—', sortValue: (b) => b.description },
    { key: 't', header: 'Budget t', align: 'right', kind: 'tonnes', render: (b) => fmtTonnes(b.budgetTonnes), sortValue: (b) => b.budgetTonnes, exportValue: (b) => b.budgetTonnes },
    { key: 'r', header: 'Budget £/t', align: 'right', kind: 'rate', render: (b) => fmtRate(b.budgetRate, 2), sortValue: (b) => b.budgetRate, exportValue: (b) => b.budgetRate },
    { key: 'v', header: 'Budget £', align: 'right', kind: 'money', render: (b) => <strong>{fmtGbp(b.budgetValue)}</strong>, sortValue: (b) => b.budgetValue, exportValue: (b) => b.budgetValue },
    { key: 'sup', header: 'Supplier / Package', render: (b) => [b.supplier, b.package].filter(Boolean).join(' · ') || '—', sortValue: (b) => b.supplier },
    { key: 'phase', header: 'Phase / Area', render: (b) => [b.phase, b.area].filter(Boolean).join(' · ') || '—', sortValue: (b) => b.phase },
    { key: 'notes', header: 'Notes', render: (b) => <span className="cell-sub">{b.notes || '—'}</span>, sortValue: (b) => b.notes },
    { key: 'src', header: 'Source', render: (b) => <SourceBadge source={b.source} />, sortValue: (b) => b.source },
    {
      key: 'act', header: '', align: 'right',
      render: (b) => (
        <span onClick={(e) => e.stopPropagation()}>
          <button
            className="btn small"
            onClick={() =>
              setEditing({
                id: b.id,
                form: {
                  scheduleRef: b.scheduleRef, location: b.location, element: b.element,
                  description: b.description, budgetTonnes: String(b.budgetTonnes),
                  budgetRate: String(b.budgetRate), supplier: b.supplier, package: b.package,
                  phase: b.phase, area: b.area, notes: b.notes,
                },
              })
            }
          >
            Edit
          </button>{' '}
          <button className="btn small danger" onClick={() => confirm(`Delete budget line ${b.scheduleRef}?`) && deleteBudgetLine(b.id)}>
            Del
          </button>
        </span>
      ),
    },
  ];

  const save = () => {
    if (!editing) return;
    const { form } = editing;
    const tonnes = Number(form.budgetTonnes) || 0;
    const rate = Number(form.budgetRate) || 0;
    const payload = {
      scheduleRef: form.scheduleRef.trim(),
      location: form.location.trim(),
      element: form.element.trim(),
      description: form.description.trim(),
      budgetTonnes: tonnes,
      budgetRate: rate,
      supplier: form.supplier.trim(),
      package: form.package.trim(),
      phase: form.phase.trim(),
      area: form.area.trim(),
      notes: form.notes.trim(),
    };
    if (editing.id) updateBudgetLine(editing.id, payload);
    else addBudgetLines([{ ...payload, projectId, source: 'manual' }]);
    setEditing(null);
  };

  const edited = editing?.id ? data.budget.find((b) => b.id === editing.id) : null;

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Budget Lines" value={rows.length} sub={`${data.budget.length} in project`} />
        <Kpi label="Budget Quantity" value={fmtTonnes(totals.t)} />
        <Kpi label="Budget Value" value={fmtGbp(totals.v)} />
        <Kpi label="Weighted Budget Rate" value={fmtRate(totals.t ? totals.v / totals.t : 0)} />
      </div>

      <Card title="Budget register" sub="Original commercial allowance — edits are logged in the audit trail">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          searchFields={(b) => `${b.scheduleRef} ${b.location} ${b.element} ${b.description} ${b.supplier} ${b.package} ${b.phase} ${b.notes}`}
          searchPlaceholder="Search schedule, location, description…"
          exportName="Rebar-Budget.xls"
          exportTitle="Reinforcement Budget"
          emptyText="No budget lines yet — add a line or import from Excel/CSV"
          toolbar={
            <FilterControls
              f={f}
              set={set}
              dates={false}
              schedules={uniqueSorted(data.budget.map((b) => b.scheduleRef))}
              locations={uniqueSorted(data.budget.map((b) => b.location))}
              suppliers={uniqueSorted(data.budget.map((b) => b.supplier))}
            />
          }
          quickAddCells={[
            <input
              key="qa-sched"
              className="qadd-in"
              value={qa.scheduleRef}
              onChange={(e) => setQa({ ...qa, scheduleRef: e.target.value })}
              placeholder="Schedule *"
              onKeyDown={commitQa}
              autoFocus
            />,
            <input
              key="qa-loc"
              className="qadd-in"
              value={qa.location}
              onChange={(e) => setQa({ ...qa, location: e.target.value })}
              placeholder="Location"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-elem"
              className="qadd-in"
              value={qa.element}
              onChange={(e) => setQa({ ...qa, element: e.target.value })}
              placeholder="Element"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-desc"
              className="qadd-in"
              value={qa.description}
              onChange={(e) => setQa({ ...qa, description: e.target.value })}
              placeholder="Description"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-t"
              className="qadd-in num"
              type="number"
              step="0.01"
              value={qa.budgetTonnes}
              onChange={(e) => setQa({ ...qa, budgetTonnes: e.target.value })}
              placeholder="t *"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-r"
              className="qadd-in num"
              type="number"
              step="0.01"
              value={qa.budgetRate}
              onChange={(e) => setQa({ ...qa, budgetRate: e.target.value })}
              placeholder="£/t *"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-v"
              className="qadd-in num"
              value={qa.budgetTonnes && qa.budgetRate ? fmtGbp((Number(qa.budgetTonnes) * Number(qa.budgetRate)) || 0) : ''}
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
              key="qa-pkg"
              className="qadd-in"
              value={qa.package}
              onChange={(e) => setQa({ ...qa, package: e.target.value })}
              placeholder="Package"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-phase"
              className="qadd-in"
              value={qa.phase}
              onChange={(e) => setQa({ ...qa, phase: e.target.value })}
              placeholder="Phase"
              onKeyDown={commitQa}
            />,
            <input
              key="qa-notes"
              className="qadd-in"
              value={qa.notes}
              onChange={(e) => setQa({ ...qa, notes: e.target.value })}
              placeholder="Notes"
              onKeyDown={commitQa}
            />,
            <span key="qa-src" className="cell-sub">Manual</span>,
            <span key="qa-act" />,
          ]}
          right={
            <>
              <button className="btn" onClick={() => setImporting(true)}>⬆ Import</button>
              <button className="btn primary" onClick={() => setEditing({ id: null, form: { ...BLANK } })}>
                + Add budget line
              </button>
            </>
          }
          footer={
            <tr>
              <td colSpan={4}>Total</td>
              <td className="num">{fmtTonnes(totals.t)}</td>
              <td className="num">{fmtRate(totals.t ? totals.v / totals.t : 0)}</td>
              <td className="num">{fmtGbp(totals.v)}</td>
              <td colSpan={5} />
            </tr>
          }
        />
      </Card>

      {importing && <ImportWizard type="budget" onClose={() => setImporting(false)} />}

      {editing && (
        <Modal
          title={editing.id ? `Edit budget line — ${edited?.scheduleRef ?? ''}` : 'Add budget line'}
          onClose={() => setEditing(null)}
          narrow
          footer={
            <>
              {edited && <SourceBadge source={edited.source} />}
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save} disabled={!editing.form.scheduleRef.trim()}>
                {editing.id ? 'Save adjustment (audited)' : 'Add line'}
              </button>
            </>
          }
        >
          {edited && (edited.importedTonnes != null || edited.importedRate != null) && (
            <div className="pill b-imported" style={{ marginBottom: 12 }}>
              Original imported values retained — {fmtTonnes(edited.importedTonnes ?? edited.budgetTonnes)} @{' '}
              {fmtRate(edited.importedRate ?? edited.budgetRate, 2)}
            </div>
          )}
          <div className="form-grid cols-2">
            <Field label="Schedule Reference *">
              <input value={editing.form.scheduleRef} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, scheduleRef: e.target.value } })} />
            </Field>
            <Field label="Location / Reference">
              <input value={editing.form.location} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, location: e.target.value } })} />
            </Field>
            <Field label="Structural Element">
              <input value={editing.form.element} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, element: e.target.value } })} />
            </Field>
            <Field label="Description">
              <input value={editing.form.description} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, description: e.target.value } })} />
            </Field>
            <Field label="Budget Quantity (t) *">
              <input type="number" step="0.01" value={editing.form.budgetTonnes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, budgetTonnes: e.target.value } })} />
            </Field>
            <Field label="Budget Rate (£/t) *">
              <input type="number" step="0.01" value={editing.form.budgetRate} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, budgetRate: e.target.value } })} />
            </Field>
            <Field label="Supplier / Package">
              <input value={editing.form.supplier} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, supplier: e.target.value } })} />
            </Field>
            <Field label="Package">
              <input value={editing.form.package} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, package: e.target.value } })} />
            </Field>
            <Field label="Phase">
              <input value={editing.form.phase} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, phase: e.target.value } })} />
            </Field>
            <Field label="Area / Zone">
              <input value={editing.form.area} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, area: e.target.value } })} />
            </Field>
            <Field label="Notes" style={{ gridColumn: 'span 2' }}>
              <textarea rows={2} value={editing.form.notes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, notes: e.target.value } })} />
            </Field>
          </div>
          <div className="stat-row" style={{ marginTop: 14 }}>
            <div className="stat">
              <div className="stat-label">Budget Value (calculated)</div>
              <div className="stat-value">
                {fmtTonnes(Number(editing.form.budgetTonnes) || 0)} × {fmtRate(Number(editing.form.budgetRate) || 0, 2)} ={' '}
                <strong>{fmtGbp((Number(editing.form.budgetTonnes) || 0) * (Number(editing.form.budgetRate) || 0))}</strong>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
