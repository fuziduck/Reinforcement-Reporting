/** Import history (§20) and Project Settings incl. audit trail (§21). */
import { useState } from 'react';
import { useProjectData } from '../lib/selectors';
import {
  addProject, deleteProject, replaceDatabase, setCurrentProject, setUser, updateProject, useDb,
} from '../lib/store';
import { buildSeedDatabase } from '../lib/seed';
import { fmtDateTime, fmtDate } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { Card, Field, Kpi, Modal } from '../components/ui';
import type { AuditEntry, ImportRecord, ProjectStatus } from '../lib/types';

const TYPE_LABEL: Record<ImportRecord['type'], string> = {
  budget: 'Reinforcement Budget',
  delivery: 'Delivery / Call-Off Schedule',
  cost: 'External Cost Data',
};

export function ImportsPage() {
  const data = useProjectData();

  const columns: Column<ImportRecord>[] = [
    { key: 'type', header: 'Import Type', render: (i) => <span className="badge b-flat">{TYPE_LABEL[i.type]}</span>, sortValue: (i) => i.type },
    { key: 'file', header: 'File Name', render: (i) => <span className="mono">{i.fileName}</span>, sortValue: (i) => i.fileName },
    { key: 'date', header: 'Import Date', kind: 'date', render: (i) => fmtDateTime(i.importedAt), sortValue: (i) => i.importedAt, exportValue: (i) => i.importedAt },
    { key: 'user', header: 'User', render: (i) => i.user, sortValue: (i) => i.user },
    { key: 'total', header: 'Records', align: 'right', kind: 'num', render: (i) => i.totalRows, sortValue: (i) => i.totalRows, exportValue: (i) => i.totalRows },
    { key: 'ok', header: 'Successful', align: 'right', kind: 'num', render: (i) => <span className="num-good">{i.imported}</span>, sortValue: (i) => i.imported, exportValue: (i) => i.imported },
    { key: 'rej', header: 'Rejected', align: 'right', kind: 'num', render: (i) => (i.rejected ? <span className="num-bad">{i.rejected}</span> : 0), sortValue: (i) => i.rejected, exportValue: (i) => i.rejected },
    { key: 'dup', header: 'Duplicates', align: 'right', kind: 'num', render: (i) => (i.duplicates ? <span className="num-bad">{i.duplicates}</span> : 0), sortValue: (i) => i.duplicates, exportValue: (i) => i.duplicates },
    { key: 'exc', header: 'Exceptions', align: 'right', kind: 'num', render: (i) => (i.exceptions ? <span className="num-flat">{i.exceptions}</span> : 0), sortValue: (i) => i.exceptions, exportValue: (i) => i.exceptions },
    {
      key: 'map', header: 'Column Mapping', render: (i) => (
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>view</summary>
          <div className="cell-sub">
            {Object.entries(i.columnMap).map(([src, dst]) => (
              <div key={src} className="mono">{src} → {dst}</div>
            ))}
          </div>
        </details>
      ),
    },
    { key: 'notes', header: 'Notes', render: (i) => <span className="cell-sub">{i.notes}</span>, sortValue: (i) => i.notes },
  ];

  return (
    <>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="Imports" value={data.imports.length} sub="All types, this project" />
        <Kpi label="Records Imported" value={data.imports.reduce((a, i) => a + i.imported, 0)} tone="good" />
        <Kpi label="Rejected Rows" value={data.imports.reduce((a, i) => a + i.rejected, 0)} tone="bad" />
        <Kpi label="Duplicate Flags" value={data.imports.reduce((a, i) => a + i.duplicates, 0)} tone="warn" />
      </div>
      <Card title="Import history" sub="Imports always add records — nothing is silently overwritten">
        <DataTable
          columns={columns}
          rows={data.imports}
          rowKey={(i) => i.id}
          searchFields={(i) => `${i.fileName} ${i.user} ${i.notes} ${TYPE_LABEL[i.type]}`}
          exportName="Rebar-Imports.xls"
          exportTitle="Import History"
          emptyText="No imports yet"
        />
      </Card>
    </>
  );
}

const STATUSES: ProjectStatus[] = ['Planning', 'Active', 'On Hold', 'Complete', 'Closed'];

export function SettingsPage() {
  const db = useDb();
  const data = useProjectData();
  const p = data.project;
  const [form, setForm] = useState(
    p
      ? {
          name: p.name, number: p.number, client: p.client, mainContractor: p.mainContractor,
          startDate: p.startDate, completionDate: p.completionDate, status: p.status,
        }
      : null,
  );
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!p || !form) return <div className="empty">No project selected.</div>;

  const auditColumns: Column<AuditEntry>[] = [
    { key: 'when', header: 'Date / Time', render: (a) => <span className="mono">{fmtDateTime(a.timestamp)}</span>, sortValue: (a) => a.timestamp },
    { key: 'user', header: 'User', render: (a) => a.user, sortValue: (a) => a.user },
    { key: 'action', header: 'Action', render: (a) => <span className="badge b-flat">{a.action}</span>, sortValue: (a) => a.action },
    { key: 'entity', header: 'Entity', render: (a) => `${a.entity}${a.field ? ` · ${a.field}` : ''}`, sortValue: (a) => a.entity },
    { key: 'orig', header: 'Original Value', render: (a) => <span className="mono">{a.originalValue || '—'}</span>, sortValue: (a) => a.originalValue },
    { key: 'new', header: 'New Value', render: (a) => <span className="mono">{a.newValue || '—'}</span>, sortValue: (a) => a.newValue },
    { key: 'notes', header: 'Notes', render: (a) => <span className="cell-sub">{a.notes}</span>, sortValue: (a) => a.notes },
  ];

  return (
    <>
      <Card
        title="Project details"
        sub={`Created ${fmtDate(p.createdAt)}`}
        right={
          <>
            {saved && <span className="pill b-costed">Saved ✓</span>}
            <button
              className="btn primary"
              onClick={() => {
                updateProject(p.id, form);
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              }}
            >
              Save project
            </button>
          </>
        }
      >
        <div className="card-body">
          <div className="form-grid">
            <Field label="Project Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Project Number">
              <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Client">
              <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </Field>
            <Field label="Main Contractor">
              <input value={form.mainContractor} onChange={(e) => setForm({ ...form, mainContractor: e.target.value })} />
            </Field>
            <Field label="Current User">
              <input value={db.user} onChange={(e) => setUser(e.target.value)} />
            </Field>
            <Field label="Start Date">
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </Field>
            <Field label="Completion Date">
              <input type="date" value={form.completionDate} onChange={(e) => setForm({ ...form, completionDate: e.target.value })} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Projects" sub="Each project holds its own budget, deliveries, costs, reconciliation and forecast — never mixed">
        <div className="card-body">
          <table className="data">
            <thead>
              <tr><th>Number</th><th>Name</th><th>Client</th><th>Status</th><th className="num">Budget £</th><th /></tr>
            </thead>
            <tbody>
              {db.projects.map((pr) => {
                const isCurrent = pr.id === db.currentProjectId;
                const budgetValue = db.budget.filter((b) => b.projectId === pr.id).reduce((a, b) => a + b.budgetValue, 0);
                return (
                  <tr key={pr.id} style={isCurrent ? { background: '#eef4fb' } : undefined}>
                    <td className="mono">{pr.number}</td>
                    <td>{pr.name} {isCurrent && <span className="pill">current</span>}</td>
                    <td>{pr.client}</td>
                    <td><span className="badge b-flat">{pr.status}</span></td>
                    <td className="num">£{budgetValue.toLocaleString('en-GB')}</td>
                    <td className="num">
                      {!isCurrent && (
                        <button className="btn small" onClick={() => setCurrentProject(pr.id)}>Open</button>
                      )}{' '}
                      <button
                        className="btn small danger"
                        onClick={() =>
                          confirm(`Delete project "${pr.name}" and ALL its data? This cannot be undone.`) &&
                          deleteProject(pr.id)
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
            <button
              className="btn"
              onClick={() =>
                confirm('Replace ALL data with fresh sample data? Deliberately imperfect test data will be regenerated.') &&
                replaceDatabase(buildSeedDatabase())
              }
            >
              ↺ Reset sample data
            </button>
          </div>
        </div>
      </Card>

      <Card title="Audit trail" sub="Every action affecting commercial data — user, date/time, action, original and new value">
        <DataTable
          columns={auditColumns}
          rows={data.audit}
          rowKey={(a) => a.id}
          searchFields={(a) => `${a.user} ${a.action} ${a.entity} ${a.field} ${a.originalValue} ${a.newValue} ${a.notes}`}
          exportName="Rebar-Audit-Trail.xls"
          exportTitle="Audit Trail"
          emptyText="No recorded changes yet"
          pageSize={25}
        />
      </Card>

      {creating && (
        <NewProjectModal
          onClose={() => setCreating(false)}
          onCreate={(v) => {
            const np = addProject(v);
            setCurrentProject(np.id);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function NewProjectModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (v: Omit<import('../lib/types').Project, 'id' | 'createdAt'>) => void;
}) {
  const [form, setForm] = useState({
    name: '', number: '', client: '', mainContractor: '',
    startDate: '', completionDate: '', status: 'Planning' as ProjectStatus,
  });
  return (
    <Modal
      title="Create project"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!form.name.trim()} onClick={() => onCreate(form)}>
            Create project
          </button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <Field label="Project Name *">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Project Number">
          <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
        </Field>
        <Field label="Client">
          <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
        </Field>
        <Field label="Main Contractor">
          <input value={form.mainContractor} onChange={(e) => setForm({ ...form, mainContractor: e.target.value })} />
        </Field>
        <Field label="Start Date">
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <Field label="Completion Date">
          <input type="date" value={form.completionDate} onChange={(e) => setForm({ ...form, completionDate: e.target.value })} />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="muted" style={{ marginTop: 12 }}>
        All budget, delivery, cost and forecast data is scoped to the project and never mixed between projects.
      </div>
    </Modal>
  );
}
