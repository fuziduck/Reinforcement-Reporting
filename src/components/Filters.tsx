/** Combinable register filters: date range, schedule, location, status, supplier, ticket. */
import type { ReactNode } from 'react';
import { MATCH_STATUS_LABEL, type MatchStatus } from '../lib/types';
import { Field } from './ui';

export interface TableFilters {
  search: string;
  from: string;
  to: string;
  schedule: string;
  location: string;
  status: string;
  supplier: string;
  ticket: string;
}

export const emptyFilters = (): TableFilters => ({
  search: '', from: '', to: '', schedule: '', location: '', status: '', supplier: '', ticket: '',
});

export function activeFilterCount(f: TableFilters): number {
  return Object.values(f).filter((v) => v !== '').length;
}

/** Date matches range (ISO yyyy-mm-dd strings). */
export function dateOk(date: string, f: TableFilters): boolean {
  if (f.from && date && date < f.from) return false;
  if (f.to && date && date > f.to) return false;
  return true;
}

export function textOk(values: (string | undefined)[], f: TableFilters): boolean {
  if (!f.search.trim()) return true;
  const q = f.search.trim().toLowerCase();
  return values.some((v) => (v ?? '').toLowerCase().includes(q));
}

export function optOk(value: string, filterValue: string): boolean {
  return !filterValue || value === filterValue;
}

export function uniqueSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export function FilterControls({
  f, set, schedules, locations, suppliers, statuses, extra, dates = true,
}: {
  f: TableFilters;
  set: (patch: Partial<TableFilters>) => void;
  schedules?: string[];
  locations?: string[];
  suppliers?: string[];
  statuses?: MatchStatus[];
  extra?: ReactNode;
  dates?: boolean;
}) {
  const n = activeFilterCount(f);
  return (
    <>
      {dates && (
        <Field label="From">
          <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
      )}
      {dates && (
        <Field label="To">
          <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
      )}
      {schedules && (
        <Field label="Schedule">
          <select value={f.schedule} onChange={(e) => set({ schedule: e.target.value })}>
            <option value="">All</option>
            {schedules.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
      {locations && (
        <Field label="Location">
          <select value={f.location} onChange={(e) => set({ location: e.target.value })}>
            <option value="">All</option>
            {locations.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
      {statuses && (
        <Field label="Status">
          <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{MATCH_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
      )}
      {suppliers && (
        <Field label="Supplier">
          <select value={f.supplier} onChange={(e) => set({ supplier: e.target.value })}>
            <option value="">All</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Ticket No">
        <input
          className="txt"
          placeholder="e.g. CARE-001042"
          value={f.ticket}
          onChange={(e) => set({ ticket: e.target.value })}
        />
      </Field>
      {extra}
      {n > 0 && (
        <button className="btn" onClick={() => set(emptyFilters())} title="Clear all filters">
          ✕ Clear filters ({n})
        </button>
      )}
    </>
  );
}
