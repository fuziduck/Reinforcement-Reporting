// UK commercial formatting helpers

export const fmtTonnes = (v: number | null | undefined, dp = 1): string =>
  v == null || Number.isNaN(v) ? '—' : `${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}t`;

export const fmtGbp = (v: number | null | undefined, dp = 0): string =>
  v == null || Number.isNaN(v) ? '—' : `£${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

/** Signed £ with explicit +/− so variances read commercially. */
export const fmtGbpSigned = (v: number | null | undefined, dp = 0): string => {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v > 0.004 ? '+' : v < -0.004 ? '−' : '';
  return `${s}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};

export const fmtRate = (v: number | null | undefined, dp = 0): string =>
  v == null || Number.isNaN(v) ? '—' : `£${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}/t`;

export const fmtRateSigned = (v: number | null | undefined, dp = 0): string => {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v > 0.004 ? '+' : v < -0.004 ? '−' : '';
  return `${s}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}/t`;
};

export const fmtPct = (v: number | null | undefined, dp = 1): string =>
  v == null || Number.isNaN(v) ? '—' : `${v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;

export const fmtPctSigned = (v: number | null | undefined, dp = 1): string => {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v > 0.004 ? '+' : v < -0.004 ? '−' : '';
  return `${s}${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
};

/** Compact £ for dense tables: £441k / £1.2m */
export const fmtGbpCompact = (v: number | null | undefined): string => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1_000_000) return `${s}£${(a / 1_000_000).toFixed(2)}m`;
  if (a >= 1_000) return `${s}£${(a / 1_000).toFixed(0)}k`;
  return `${s}£${a.toFixed(0)}`;
};

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const monthKey = (iso: string): string => (iso || '').slice(0, 7); // yyyy-mm

export const monthLabel = (key: string): string => {
  const d = new Date(`${key}-01T00:00:00`);
  return Number.isNaN(d.getTime()) ? key : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

export const varianceClass = (v: number | null | undefined): string =>
  v == null || Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'bad' : 'good';
