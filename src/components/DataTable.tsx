/** Generic data table: search, sort, pagination, Excel export, row click. */
import { useMemo, useState, type ReactNode } from 'react';
import { exportWorkbook, type ColKind } from '../lib/exporters';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  kind?: ColKind;
  width?: number;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  exportValue?: (row: T) => string | number | null;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  searchFields?: (row: T) => string;
  searchPlaceholder?: string;
  exportName?: string;
  exportTitle?: string;
  pageSize?: number;
  emptyText?: string;
  right?: ReactNode;
  /** Inline entry row pinned above the header — one cell per column, Enter commits. */
  quickAddCells?: (ReactNode | null)[];
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, rowClass, toolbar, footer,
  searchFields, searchPlaceholder = 'Search…', exportName, exportTitle,
  pageSize = 50, emptyText = 'No records', right, quickAddCells,
}: Props<T>) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const searched = useMemo(() => {
    if (!search.trim() || !searchFields) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => searchFields(r).toLowerCase().includes(q));
  }, [rows, search, searchFields]);

  const sorted = useMemo(() => {
    if (!sort) return searched;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return searched;
    const sv = col.sortValue;
    return [...searched].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sort.dir;
    });
  }, [searched, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const doExport = () => {
    if (!exportName) return;
    exportWorkbook(
      exportName,
      [
        {
          name: (exportTitle ?? exportName).slice(0, 31),
          title: exportTitle ?? exportName,
          columns: columns.map((c) => ({
            header: c.header,
            kind: c.kind ?? (c.align === 'right' ? 'num' : 'text'),
            width: c.width ?? Math.max(10, c.header.length + 4),
          })),
          rows: sorted.map((r) =>
            columns.map((c) => {
              const v = (c.exportValue ?? c.sortValue)?.(r);
              return v == null ? null : v;
            }),
          ),
        },
      ],
      exportTitle ?? exportName,
    );
  };

  return (
    <>
      {(toolbar || searchFields || exportName || right) && (
        <div className="filters">
          {searchFields && (
            <div className="field grow">
              <label>Search</label>
              <input
                className="txt"
                value={search}
                placeholder={searchPlaceholder}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          )}
          {toolbar}
          {right}
          {exportName && (
            <button className="btn" onClick={doExport} title="Export visible table to Excel">
              ⬇ Excel
            </button>
          )}
          <span className="filter-count">
            {sorted.length === rows.length
              ? `${rows.length} records`
              : `${sorted.length} of ${rows.length} records`}
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`${c.align === 'right' ? 'num' : ''} ${c.sortValue ? 'sortable' : ''}`}
                    style={c.width ? { minWidth: c.width } : undefined}
                    onClick={() =>
                      c.sortValue &&
                      setSort((s) =>
                        s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 },
                      )
                    }
                    title={c.sortValue ? 'Click to sort' : undefined}
                  >
                    {c.header}
                    {active ? (sort!.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                );
              })}
            </tr>
            {quickAddCells && (
              <tr className="qadd">
                {quickAddCells.map((cell, i) => (
                  <td key={i} className={columns[i]?.align === 'right' ? 'num' : ''}>
                    {cell}
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
                  <div className="empty">{emptyText}</div>
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr
                key={rowKey(r)}
                className={`${onRowClick ? 'clickable' : ''} ${rowClass?.(r) ?? ''}`}
                onClick={() => onRowClick?.(r)}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {pages > 1 && (
        <div className="filters" style={{ justifyContent: 'flex-end', borderBottom: 0 }}>
          <button className="btn small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ◀ Prev
          </button>
          <span className="filter-count">
            Page {safePage + 1} of {pages}
          </span>
          <button className="btn small" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>
            Next ▶
          </button>
        </div>
      )}
    </>
  );
}
