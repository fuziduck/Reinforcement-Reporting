/**
 * Import wizard: Upload → Map columns → Preview & validate → Confirm.
 * Rejects invalid rows (counted in the import history), flags duplicates and
 * missing fields, and retains every original source value on the record.
 */
import { useMemo, useRef, useState } from 'react';
import {
  autoMap, buildPreview, parseCsv as parseCsvText, parseDate, parseFile, parseNumber,
  FIELDS_BY_TYPE, FIELD_LABEL, type AppField, type ColumnMap, type ParsedSheet, type PreviewResult,
} from '../lib/importers';
import type { ImportType } from '../lib/types';
import { addBudgetLines, addCosts, addDeliveries, addImport, useDb } from '../lib/store';
import { normaliseTicket } from '../lib/matching';
import { Modal, Field } from './ui';

const TYPE_LABEL: Record<ImportType, string> = {
  budget: 'Reinforcement Budget',
  delivery: 'Delivery / Call-Off Schedule',
  cost: 'External Cost Data',
};

export function ImportWizard({ type, onClose }: { type: ImportType; onClose: () => void }) {
  const db = useDb();
  const projectId = db.currentProjectId ?? '';
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const existingTickets = useMemo(() => {
    const norm = (s: string) => normaliseTicket(s).toUpperCase().replace(/^0+/, '');
    const keys = new Set<string>();
    if (type !== 'cost') db.deliveries.filter((d) => d.projectId === projectId).forEach((d) => d.ticketNo && keys.add(norm(d.ticketNo)));
    if (type !== 'delivery') db.costs.filter((c) => c.projectId === projectId).forEach((c) => c.ticketNo && keys.add(norm(c.ticketNo)));
    return keys;
  }, [db, projectId, type]);

  const loadSheet = (s: ParsedSheet, name: string) => {
    setSheet(s);
    setFileName(name);
    setMap(autoMap(s.headers));
    setStage(1);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      loadSheet(await parseFile(file), file.name);
    } catch {
      alert('Could not read this file. Use CSV or Excel (.xlsx/.xls).');
    }
  };

  const runPreview = () => {
    if (!sheet) return;
    setPreview(buildPreview(sheet, map, type, existingTickets));
    setStage(2);
  };

  const confirmImport = () => {
    if (!sheet || !preview) return;
    const good = preview.rows.filter((r) => r.status !== 'error');
    const imp = addImport({
      projectId,
      type,
      fileName,
      user: db.user,
      columnMap: Object.fromEntries(
        Object.entries(map)
          .filter(([, f]) => f)
          .map(([ci, f]) => [sheet.headers[Number(ci)] || `Column ${Number(ci) + 1}`, f as string]),
      ),
      totalRows: preview.rows.length,
      imported: good.length,
      rejected: preview.rows.length - good.length,
      duplicates: preview.counts.duplicates,
      exceptions: preview.rows.filter((r) => r.status === 'warning').length,
      notes: `Mapped ${Object.values(map).filter(Boolean).length} columns`,
    });

    const val = (r: (typeof good)[0], f: AppField): string => (r.values[f] ?? '').trim();
    const num = (r: (typeof good)[0], f: AppField): number => parseNumber(val(r, f)) ?? 0;

    if (type === 'budget') {
      addBudgetLines(
        good.map((r) => ({
          projectId,
          scheduleRef: val(r, 'scheduleRef'),
          location: val(r, 'location'),
          element: val(r, 'element'),
          description: val(r, 'description'),
          budgetTonnes: num(r, 'budgetTonnes'),
          budgetRate: num(r, 'budgetRate'),
          supplier: val(r, 'supplier'),
          package: val(r, 'package'),
          phase: val(r, 'phase'),
          area: val(r, 'area'),
          notes: val(r, 'notes'),
          source: 'imported' as const,
          importId: imp.id,
        })),
      );
    } else if (type === 'delivery') {
      addDeliveries(
        good.map((r) => {
          const ticketNo = val(r, 'ticketNo');
          const tonnes = num(r, 'tonnes');
          return {
            projectId,
            deliveryDate: parseDate(val(r, 'deliveryDate')),
            ticketNo,
            scheduleRef: val(r, 'scheduleRef'),
            location: val(r, 'location'),
            element: val(r, 'element'),
            area: val(r, 'area'),
            package: val(r, 'package'),
            phase: val(r, 'phase'),
            tonnes,
            description: val(r, 'description'),
            supplier: val(r, 'supplier'),
            source: 'imported' as const,
            importId: imp.id,
            importedTonnes: tonnes,
            importedTicketNo: ticketNo,
            raw: r.raw,
          };
        }),
      );
    } else {
      addCosts(
        good.map((r) => {
          const ticketNo = val(r, 'ticketNo');
          const costedTonnes = num(r, 'costedTonnes');
          const cost = num(r, 'cost');
          return {
            projectId,
            costDate: parseDate(val(r, 'costDate')),
            ticketNo,
            costedTonnes,
            cost,
            supplier: val(r, 'supplier'),
            costRef: val(r, 'costRef'),
            source: 'imported' as const,
            importId: imp.id,
            importedTonnes: costedTonnes,
            importedCost: cost,
            importedTicketNo: ticketNo,
            raw: r.raw,
          };
        }),
      );
    }
    onClose();
  };

  const fields = FIELDS_BY_TYPE[type];
  const mappedCount = Object.values(map).filter(Boolean).length;

  return (
    <Modal
      title={`Import ${TYPE_LABEL[type]}`}
      steps={[
        { label: '1 Upload', active: stage === 0, done: stage > 0 },
        { label: '2 Map columns', active: stage === 1, done: stage > 1 },
        { label: '3 Preview & validate', active: stage === 2, done: false },
      ]}
      onClose={onClose}
      footer={
        <>
          {stage > 0 && (
            <button className="btn" onClick={() => setStage((s) => (s - 1) as 0 | 1)}>
              ◀ Back
            </button>
          )}
          {stage === 1 && (
            <button className="btn primary" disabled={mappedCount === 0} onClick={runPreview}>
              Preview & validate ▶
            </button>
          )}
          {stage === 2 && preview && (
            <button className="btn primary" disabled={preview.counts.ok + preview.counts.warning === 0} onClick={confirmImport}>
              ✓ Import {preview.counts.ok + preview.counts.warning} valid records
              {preview.counts.error > 0 ? ` (${preview.counts.error} rejected)` : ''}
            </button>
          )}
        </>
      }
    >
      {stage === 0 && (
        <div>
          <p className="muted">
            Upload the {TYPE_LABEL[type].toLowerCase()} as <strong>Excel (.xlsx/.xls)</strong> or <strong>CSV</strong>.
            Source headings do not need to match — you will map columns on the next step.
          </p>
          <div
            style={{
              border: '2px dashed var(--line-2)', borderRadius: 8, padding: 42, textAlign: 'center',
              background: '#fafbfc',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.tsv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button className="btn primary" onClick={() => fileRef.current?.click()}>
              ⬆ Choose file
            </button>
            <div className="muted" style={{ marginTop: 10 }}>
              or drag & drop into this panel
            </div>
            <div
              style={{ marginTop: 8 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files?.[0]);
              }}
            />
          </div>
          <details style={{ marginTop: 14 }}>
            <summary className="muted">Paste CSV text instead</summary>
            <PasteCsv onParsed={(s) => loadSheet(s, 'pasted-data.csv')} />
          </details>
        </div>
      )}

      {stage === 1 && sheet && (
        <div>
          <p className="muted">
            <strong>{fileName}</strong> — {sheet.rows.length} data rows, {sheet.headers.length} source columns.
            Map each source column to an application field ({mappedCount} mapped).
          </p>
          <div className="map-grid">
            {sheet.headers.map((h, i) => (
              <div className="map-row" key={i}>
                <div className="src" title={h}>{h || `Column ${i + 1}`}</div>
                <div className="muted">→</div>
                <select
                  className="txt"
                  value={map[i] ?? ''}
                  onChange={(e) => setMap({ ...map, [i]: e.target.value as AppField | '' })}
                >
                  <option value="">— ignore —</option>
                  {fields.map((f) => (
                    <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }} className="muted">
            Required:{' '}
            {(type === 'budget'
              ? ['scheduleRef', 'budgetTonnes', 'budgetRate']
              : type === 'delivery'
                ? ['deliveryDate', 'ticketNo', 'tonnes']
                : ['ticketNo', 'costedTonnes', 'cost']
            )
              .map((f) => FIELD_LABEL[f as AppField])
              .join(', ')}
          </div>
        </div>
      )}

      {stage === 2 && preview && sheet && (
        <div>
          <div className="stat-row" style={{ marginBottom: 12 }}>
            <Stat label="Rows" value={preview.counts.total} />
            <Stat label="Valid" value={preview.counts.ok} tone="good" />
            <Stat label="Warnings" value={preview.counts.warning} tone="warn" />
            <Stat label="Rejected" value={preview.counts.error} tone="bad" />
            <Stat label="Duplicate tickets" value={preview.counts.duplicates} tone="bad" />
          </div>
          {preview.missingRequired.length > 0 && (
            <div className="row-err" style={{ marginBottom: 8 }}>
              Missing required mapping: {preview.missingRequired.map((f) => FIELD_LABEL[f]).join(', ')}
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: '44vh' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Row</th>
                  {fields
                    .filter((f) => Object.values(map).includes(f))
                    .map((f) => (
                      <th key={f}>{FIELD_LABEL[f]}</th>
                    ))}
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((r) => (
                  <tr key={r.index} className={r.status === 'error' ? 'r-error' : r.status === 'warning' ? 'r-warn' : ''}>
                    <td className="mono">{r.index}</td>
                    {fields
                      .filter((f) => Object.values(map).includes(f))
                      .map((f) => (
                        <td key={f}>{r.values[f] ?? ''}</td>
                      ))}
                    <td>
                      {r.errors.map((e, i) => (
                        <div key={`e${i}`} className="row-err">✕ {e}</div>
                      ))}
                      {r.warnings.map((w, i) => (
                        <div key={`w${i}`} className="row-warn">⚠ {w}</div>
                      ))}
                      {r.status === 'ok' && <span className="badge b-costed">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 100 && (
            <div className="muted" style={{ marginTop: 8 }}>
              Showing first 100 of {preview.rows.length} rows — all rows will be validated on import.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--ink)';
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
    </div>
  );
}

function PasteCsv({ onParsed }: { onParsed: (s: ParsedSheet) => void }) {
  const [text, setText] = useState('');
  return (
    <div style={{ marginTop: 8 }}>
      <Field label="CSV text">
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Date,Ticket,Tonnage\n…'} />
      </Field>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => onParsed(parseCsvText(text))}>
        Use pasted data
      </button>
    </div>
  );
}
