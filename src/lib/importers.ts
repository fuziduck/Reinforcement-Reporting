/**
 * Import pipeline: parse (CSV / XLSX) → column mapping → validation preview →
 * commit. Source columns are user-mapped to application fields (source
 * spreadsheets never share the same headings). Original rows are retained
 * verbatim on every record. Nothing is ever silently overwritten: imports
 * always add records and are recorded in the import history.
 */
import * as XLSX from 'xlsx';
import type { ImportType } from './types';

export type AppField =
  | 'scheduleRef' | 'location' | 'element' | 'description'
  | 'budgetTonnes' | 'budgetRate'
  | 'deliveryDate' | 'ticketNo' | 'tonnes'
  | 'costDate' | 'costedTonnes' | 'cost' | 'costRef'
  | 'supplier' | 'package' | 'phase' | 'area' | 'notes';

export const FIELD_LABEL: Record<AppField, string> = {
  scheduleRef: 'Schedule Reference',
  location: 'Location',
  element: 'Structural Element',
  description: 'Description',
  budgetTonnes: 'Budget Tonnes',
  budgetRate: 'Budget Rate £/t',
  deliveryDate: 'Delivery Date',
  ticketNo: 'Delivery Ticket No',
  tonnes: 'Tonnes',
  costDate: 'Cost Date',
  costedTonnes: 'Costed Tonnes',
  cost: 'Cost £',
  costRef: 'Cost Reference',
  supplier: 'Supplier',
  package: 'Package',
  phase: 'Phase',
  area: 'Area / Zone',
  notes: 'Notes',
};

export const FIELDS_BY_TYPE: Record<ImportType, AppField[]> = {
  budget: ['scheduleRef', 'location', 'element', 'description', 'budgetTonnes', 'budgetRate', 'supplier', 'package', 'phase', 'area', 'notes'],
  delivery: ['deliveryDate', 'ticketNo', 'scheduleRef', 'location', 'element', 'tonnes', 'description', 'supplier', 'package', 'phase', 'area', 'notes'],
  cost: ['costDate', 'ticketNo', 'costedTonnes', 'cost', 'supplier', 'costRef', 'notes'],
};

const REQUIRED: Record<ImportType, AppField[]> = {
  budget: ['scheduleRef', 'budgetTonnes', 'budgetRate'],
  delivery: ['deliveryDate', 'ticketNo', 'tonnes'],
  cost: ['ticketNo', 'costedTonnes', 'cost'],
};

const ALIASES: [AppField, string[]][] = [
  ['scheduleRef', ['schedule', 'schedule ref', 'schedule reference', 'sched', 'sched ref', 'calloff', 'call off', 'call-off', 'call-off no', 'calloff ref', 'schedule no']],
  ['location', ['location', 'location ref', 'location reference', 'loc', 'loc ref', 'site area']],
  ['element', ['element', 'structural element', 'structure', 'elem']],
  ['description', ['description', 'desc', 'item', 'detail', 'particulars']],
  ['budgetTonnes', ['budget tonnes', 'budget tonnage', 'budget t', 'budget ton', 'tonnes', 'tonnage', 'tons', 'qty', 'quantity', 'weight']],
  ['budgetRate', ['budget rate', 'budget £/t', 'budget rate £/t', 'rate', 'unit rate', '£/t', 'price per tonne']],
  ['deliveryDate', ['delivery date', 'del date', 'date', 'ticket date', 'docket date']],
  ['ticketNo', ['ticket', 'ticket no', 'ticket number', 'ticket #', 'delivery ticket', 'delivery ticket no', 'delivery ticket number', 'ticket ref', 'docket', 'docket no', 'waybill', 'note no']],
  ['tonnes', ['tonnage', 'tonnes', 'tons', 'ton', 'delivered tonnes', 'delivered tonnage', 'weight', 'qty', 'quantity']],
  ['costDate', ['cost date', 'invoice date', 'date', 'posted date', 'cost entry date']],
  ['costedTonnes', ['costed tonnes', 'costed tonnage', 'tonnage', 'tonnes', 'tons', 'invoiced tonnes', 'qty', 'quantity', 'weight']],
  ['cost', ['cost', 'value', 'amount', 'net value', 'gross value', '£', 'cost £', 'invoiced value', 'invoice value']],
  ['costRef', ['cost ref', 'cost reference', 'reference', 'ref', 'invoice no', 'invoice number', 'inv no', 'cost code']],
  ['supplier', ['supplier', 'vendor', 'subcontractor', 'subbie', 'merchant']],
  ['package', ['package', 'pkg', 'package ref']],
  ['phase', ['phase', 'project phase']],
  ['area', ['area', 'zone', 'area/zone', 'area / zone']],
  ['notes', ['notes', 'note', 'comments', 'comment', 'remarks']],
];

// --- Parsing ----------------------------------------------------------------

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedSheet {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  const delim = detectDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      cur.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      rows.push(cur); cur = [];
    } else field += ch;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  return { headers: nonEmpty[0].map((h) => h.trim()), rows: nonEmpty.slice(1) };
}

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/)[0] ?? '';
  const counts = [
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
    ['|', (line.match(/\|/g) ?? []).length],
  ] as [string, number][];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export async function parseFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    return parseCsv(await file.text());
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, raw: false, defval: '' });
  if (matrix.length === 0) return { headers: [], rows: [] };
  return {
    headers: (matrix[0] ?? []).map((h) => String(h).trim()),
    rows: matrix.slice(1).map((r) => (r ?? []).map((c) => String(c ?? ''))),
  };
}

// --- Column mapping ---------------------------------------------------------

export type ColumnMap = Record<number, AppField | ''>;

/** Guess a sensible default mapping from the source headings. */
export function autoMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<AppField>();
  headers.forEach((h, i) => {
    const norm = h.toLowerCase().replace(/[^a-z0-9£/ ]+/g, '').replace(/\s+/g, ' ').trim();
    let hit: AppField | '' = '';
    outer: for (const [field, aliases] of ALIASES) {
      if (used.has(field)) continue;
      for (const a of aliases) {
        if (norm === a) { hit = field; break outer; }
      }
    }
    if (!hit) {
      outer2: for (const [field, aliases] of ALIASES) {
        if (used.has(field)) continue;
        for (const a of aliases) {
          if (norm.includes(a) || a.includes(norm)) { hit = field; break outer2; }
        }
      }
    }
    if (hit) used.add(hit);
    map[i] = hit;
  });
  return map;
}

// --- Value parsing ----------------------------------------------------------

export function parseNumber(raw: string): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[£$,\s]/g, '').replace(/[^0-9.\-eE+]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const uk = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (uk) {
    let [, d, m, y] = uk;
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// --- Validation preview -----------------------------------------------------

export interface RowPreview {
  index: number; // 1-based source row number (header = row 0)
  raw: Record<string, string>;
  values: Partial<Record<AppField, string>>;
  errors: string[];
  warnings: string[];
  status: 'ok' | 'warning' | 'error';
}

export interface PreviewResult {
  rows: RowPreview[];
  mapping: ColumnMap;
  missingRequired: AppField[];
  counts: { total: number; ok: number; warning: number; error: number; duplicates: number };
}

export function buildPreview(
  sheet: ParsedSheet,
  mapping: ColumnMap,
  type: ImportType,
  existingTickets: Set<string>,
): PreviewResult {
  const mappedFields = new Set(
    Object.values(mapping).filter((f): f is AppField => f !== ''),
  );
  const missingRequired = REQUIRED[type].filter((f) => !mappedFields.has(f));
  const rows: RowPreview[] = [];
  const seenInFile = new Map<string, number>();
  let duplicates = 0;

  sheet.rows.forEach((cells, i) => {
    const raw: Record<string, string> = {};
    sheet.headers.forEach((h, ci) => {
      raw[h || `Column ${ci + 1}`] = cells[ci] ?? '';
    });
    const values: Partial<Record<AppField, string>> = {};
    for (const [ci, field] of Object.entries(mapping)) {
      if (field) values[field] = cells[Number(ci)] ?? '';
    }
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const f of REQUIRED[type]) {
      if (!values[f] || String(values[f]).trim() === '') errors.push(`${FIELD_LABEL[f]} is required`);
    }

    const numField: AppField | null =
      type === 'budget' ? 'budgetTonnes' : type === 'delivery' ? 'tonnes' : 'costedTonnes';
    const numRaw = values[numField];
    if (numRaw !== undefined && String(numRaw).trim() !== '') {
      const n = parseNumber(numRaw);
      if (n == null) errors.push(`Invalid tonnage "${numRaw}"`);
      else if (n <= 0) errors.push(`Invalid tonnage: must be greater than zero`);
    }
    if (type === 'budget') {
      const r = parseNumber(values.budgetRate ?? '');
      if (values.budgetRate && r == null) errors.push(`Invalid rate "${values.budgetRate}"`);
      else if (r != null && r <= 0) warnings.push('Rate is zero or negative');
    }
    if (type === 'cost') {
      const c = parseNumber(values.cost ?? '');
      if (values.cost && c == null) errors.push(`Invalid cost "${values.cost}"`);
    }
    const dateField: AppField | null =
      type === 'delivery' ? 'deliveryDate' : type === 'cost' ? 'costDate' : null;
    if (dateField && values[dateField] && parseDate(values[dateField] ?? '') === '') {
      warnings.push(`Unrecognised date "${values[dateField]}"`);
    }

    const ticket = (values.ticketNo ?? '').trim();
    if (type !== 'budget') {
      if (!ticket) warnings.push('Missing ticket number — record cannot be matched');
      else {
        const key = ticket.toUpperCase().replace(/[^A-Z0-9]+/g, '').replace(/^0+/, '');
        const prevSeen = seenInFile.get(key);
        if (prevSeen != null) {
          errors.push(`Duplicate ticket number (also on row ${prevSeen + 1})`);
          duplicates++;
        } else {
          seenInFile.set(key, i);
        }
        if (existingTickets.has(key)) warnings.push('Ticket already exists in the register');
      }
    }
    if (type === 'delivery') {
      if (!values.scheduleRef) warnings.push('Missing schedule reference');
      if (!values.location) warnings.push('Missing location');
    }

    rows.push({
      index: i + 1,
      raw, values, errors, warnings,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok',
    });
  });

  const counts = {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    warning: rows.filter((r) => r.status === 'warning').length,
    error: rows.filter((r) => r.status === 'error').length,
    duplicates,
  };
  return { rows, mapping, missingRequired, counts };
}
