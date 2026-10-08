/** Delivery Register — physical reinforcement delivered to site. */
import { useMemo, useState } from 'react';
import type { Delivery, MatchStatus } from '../lib/types';
import { useProjectData } from '../lib/selectors';
import { addDeliveries, deleteDelivery, updateDelivery, useDb } from '../lib/store';
import { fmtDate, fmtTonnes } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Field, Kpi, Modal, SourceBadge, StatusBadge } from '../components/ui';
import { FilterControls, dateOk, emptyFilters, optOk, textOk, uniqueSorted, type TableFilters } from '../components/Filters';
import { ImportWizard } from '../components/ImportWizard';

const BLANK = {
  deliveryDate: '', ticketNo: '', scheduleRef: '', location: '', element: '',
  area: '', package: '', phase: '', tonnes: '', description: '', supplier: '',
};

const ALL_STATUSES: MatchStatus[] = [
  'COSTED', 'DELIVERED_UNCOSTED', 'TONNAGE_MISMATCH', 'DUPLICATE', 'MATCH_REVIEW',
];

export function DeliveriesPage() {
  const data = useProjectData();
  const db = useDb();
  const projectId = db.currentProjectId ?? '';
  const [f, setF] = useState<TableFilters>(emptyFilters());
  const set = (patch: Partial<TableFilters>) => setF((x) => ({ ...x, ...patch }));
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; form: typeof BLANK } | null>(null);
  // Inline quick-add row — type across the fields, Enter commits, row clears for next entry.
  const [qa, setQa] = useState<typeof BLANK>({ ...BLANK });
  const qHasData = qa.deliveryDate || qa.ticketNo.trim() || qa.scheduleRef.trim() || qa.location.trim() ||
    qa.element.trim() || (qa.tonnes as unknown as boolean) || qa.supplier.trim() || qa.description.trim();
  const commitQa = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    if (!qa.ticketNo.trim() || !qa.scheduleRef.trim() || !(Number(qa.tonnes) || 0)) return;
    addDeliveries([{
      projectId,
      deliveryDate: qa.deliveryDate,
      ticketNo: qa.ticketNo.trim(),
      scheduleRef: qa.scheduleRef.trim(),
      location: qa.location.trim(),
      element: qa.element.trim(),
      area: qa.area.trim(),
      package: qa.package.trim(),
      phase: qa.phase.trim(),
      tonnes: Number(qa.tonnes) || 0,
      description: qa.description.trim(),
      supplier: qa.supplier.trim(),
      source: 'manual',
      raw: {},
    }]);
    setQa({ ...BLANK });
  };

  const statusByDelivery = useMemo(() => {
    const m = new Map<string, MatchStatus>();
    for (const r of data.rows) if (r.deliveryId) m.set(r.deliveryId, r.status);
    return m;
  }, [data.rows]);

  const rows = useMemo(
    () =>
      data.deliveries.filter((d) => {
        const st = statusByDelivery.get(d.id);
        return (
          dateOk(d.deliveryDate, f) &&
          optOk(d.scheduleRef, f.schedule) &&
          optOk(d.location, f.location) &&
          optOk(d.supplier, f.supplier) &&
          (!f.status || st === f.status) &&
          (!f.ticket || d.ticketNo.toLowerCase().includes(f.ticket.toLowerCase())) &&
          textOk([d.ticketNo, d.scheduleRef, d.location, d.element, d.description, d.supplier, d.package, d.phase], f)
        );
      }),
    [data.deliveries, statusByDelivery, f],
  );
  const totalTonnes = rows.reduce((a, d) => a + d.tonnes, 0);
  const uncostedTonnes = rows
    .filter((d) => statusByDelivery.get(d.id) !== 'COSTED')
    .reduce((a, d) => a + d.tonnes, 0);

  const columns: Column<Delivery>[] = [
    { key: 'date', header: 'Delivery Date', kind: 'date', render: (d) => fmtDate(d.deliveryDate), sortValue: (d) => d.deliveryDate, exportValue: (d) => d.deliveryDate },
    { key: 'ticket', header: 'Ticket No', render: (d) => <span className="mono">{d.ticketNo || <em className="num-bad">(missing)</em>}</span>, sortValue: (d) => d.ticketNo },
    { key: 'sched', header: 'Schedule', render: (d) => d.scheduleRef || <em className="num-bad">(missing)</em>, sortValue: (d) => d.scheduleRef },
    { key: 'loc', header: 'Location', render: (d) => d.location || <em className="num-bad">(missing)</em>, sortValue: (d) => d.location },
    { key: 'elem', header: 'Element', render: (d) => d.element || '—', sortValue: (d) => d.element },
    { key: 't', header: 'Tonnes', align: 'right', kind: 'tonnes', render: (d) => fmtTonnes(d.tonnes, 2), sortValue: (d) => d.tonnes, exportValue: (d) => d.tonnes },
    { key: 'desc', header: 'Description', render: (d) => <span className="cell-sub">{d.description || '—'}</span>, sortValue: (d) => d.description },
    { key: 'sup', header: 'Supplier', render: (d) => d.supplier || '—', sortValue: (d) => d.supplier },
    { key: 'grp', header: 'Package / Phase', render: (d) => [d.package, d.phase].filter(Boolean).join(' · ') || '—', sortValue: (d) => d.package },
    {
      key: 'status', header: 'Status', render: (d) => {
        const st = statusByDelivery.get(d.id);
        return st ? <StatusBadge status={st} /> : <span className="badge b-flat">—</span>;
      },
      sortValue: (d) => statusByDelivery.get(d.id) ?? '',
    },
    { key: 'src', header: 'Source', render: (d) => <SourceBadge source={d.source} />, sortValue: (d) => d.source },
    {
      key: 'act', header: '', align: 'right',
      render: (d) => (
        <span onClick={(e) => e.stopPropagation()}>
          <button
            className="btn small"
            onClick={() =>
              setEditing({
                id: d.id,
                form: {
                  deliveryDate: d.deliveryDate, ticketNo: d.ticketNo, scheduleRef: d.scheduleRef,
                  location: d.location, element: d.element, area: d.area, package: d.package,
                  phase: d.phase, tonnes: String(d.tonnes), description: d.description, supplier: d.supplier,
                },
              })
            }
          >
            Edit
          </button>{' '}
          <button className="btn small danger" onClick={() => confirm(`Delete delivery ${d.ticketNo}?`) && deleteDelivery(d.id)}>
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
      deliveryDate: form.deliveryDate,
      ticketNo: form.ticketNo.trim(),
      scheduleRef: form.scheduleRef.trim(),
      location: form.location.trim(),
      element: form.element.trim(),
      area: form.area.trim(),
      package: form.package.trim(),
      phase: form.phase.trim(),
      tonnes: Number(form.tonnes) || 0,
      description: form.description.trim(),
      supplier: form.supplier.trim(),
    };
    if (editing.id) updateDelivery(editing.id, payload);
    else addDeliveries([{ ...payload, projectId, source: 'manual', raw: {} }]);
    setEditing(null);
  };

  const edited = editing?.id ? data.deliveries.find((d) => d.id === editing.id) : null;
  const fset = (patch: Partial<TableFilters>) => set(patch);

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Deliveries" value={rows.length} sub={`${data.deliveries.length} in project`} />
        <Kpi label="Delivered Tonnes" value={fmtTonnes(totalTonnes, 2)} />
        <Kpi label="Costed" tone="good" value={`${rows.filter((d) => statusByDelivery.get(d.id) === 'COSTED').length} tickets`} />
        <Kpi label="Uncosted / Exception" tone="warn" value={fmtTonnes(uncostedTonnes, 2)} sub="Delivered but not cleanly costed" />
      </div>

      <Card title="Delivery register" sub="Site delivery / call-off records — original imported values retained">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          searchFields={(d) => `${d.ticketNo} ${d.scheduleRef} ${d.location} ${d.element} ${d.description} ${d.supplier} ${d.package} ${d.phase}`}
          searchPlaceholder="Search ticket, schedule, location…"
          exportName="Rebar-Deliveries.xls"
          exportTitle="Delivery Register"
          emptyText="No deliveries yet — import a call-off schedule or add a delivery"
          toolbar={
            <FilterControls
              f={f}
              set={fset}
              schedules={uniqueSorted(data.deliveries.map((d) => d.scheduleRef))}
              locations={uniqueSorted(data.deliveries.map((d) => d.location))}
              suppliers={uniqueSorted(data.deliveries.map((d) => d.supplier))}
              statuses={ALL_STATUSES}
            />
          }
          quickAddCells={[
            <input
              key="qa-date"
              className="qadd-in"
              type="date"
              value={qa.deliveryDate}
              onChange={(e) => setQa({ ...qa, deliveryDate: e.target.value })}
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
              key="qa-sched"
              className="qadd-in"
              value={qa.scheduleRef}
              onChange={(e) => setQa({ ...qa, scheduleRef: e.target.value })}
              placeholder="Schedule *"
              onKeyDown={commitQa}
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
              key="qa-t"
              className="qadd-in num"
              type="number"
              step="0.01"
              value={qa.tonnes}
              onChange={(e) => setQa({ ...qa, tonnes: e.target.value })}
              placeholder="t *"
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
            <span key="qa-status" className="cell-sub">—</span>,
            <span key="qa-src" className="cell-sub">Manual</span>,
            <span key="qa-act" />,
          ]}
          right={
            <>
              <button className="btn" onClick={() => setImporting(true)}>⬆ Import</button>
              <button className="btn primary" onClick={() => setEditing({ id: null, form: { ...BLANK } })}>
                + Add delivery
              </button>
            </>
          }
          footer={
            <tr>
              <td colSpan={5}>Total</td>
              <td className="num">{fmtTonnes(totalTonnes, 2)}</td>
              <td colSpan={6} />
            </tr>
          }
        />
      </Card>

      {importing && <ImportWizard type="delivery" onClose={() => setImporting(false)} />}

      {editing && (
        <Modal
          title={editing.id ? `Edit delivery — ${edited?.ticketNo || '(no ticket)'}` : 'Add delivery'}
          onClose={() => setEditing(null)}
          narrow
          footer={
            <>
              {edited && <SourceBadge source={edited.source} />}
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" onClick={save}>
                {editing.id ? 'Save adjustment (audited)' : 'Add delivery'}
              </button>
            </>
          }
        >
          {edited && edited.importedTonnes != null && edited.importedTonnes !== edited.tonnes && (
            <div className="pill b-imported" style={{ marginBottom: 12 }}>
              Original imported value retained — {fmtTonnes(edited.importedTonnes, 2)}
            </div>
          )}
          <div className="form-grid cols-2">
            <Field label="Delivery Date">
              <input type="date" value={editing.form.deliveryDate} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, deliveryDate: e.target.value } })} />
            </Field>
            <Field label="Delivery Ticket No">
              <input value={editing.form.ticketNo} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, ticketNo: e.target.value } })} />
            </Field>
            <Field label="Schedule Reference">
              <input value={editing.form.scheduleRef} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, scheduleRef: e.target.value } })} />
            </Field>
            <Field label="Location">
              <input value={editing.form.location} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, location: e.target.value } })} />
            </Field>
            <Field label="Structural Element">
              <input value={editing.form.element} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, element: e.target.value } })} />
            </Field>
            <Field label="Tonnes">
              <input type="number" step="0.01" value={editing.form.tonnes} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, tonnes: e.target.value } })} />
            </Field>
            <Field label="Supplier">
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
            <Field label="Description" style={{ gridColumn: 'span 2' }}>
              <input value={editing.form.description} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, description: e.target.value } })} />
            </Field>
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
