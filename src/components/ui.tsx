/** Shared presentational components: badges, KPI cards, modals, form fields. */
import type { ReactNode } from 'react';
import { MATCH_STATUS_LABEL, type MatchStatus, type RecordSource } from '../lib/types';

export function StatusBadge({ status }: { status: MatchStatus }) {
  const cls: Record<MatchStatus, string> = {
    COSTED: 'b-costed',
    DELIVERED_UNCOSTED: 'b-uncosted',
    COST_NO_DELIVERY: 'b-nodelivery',
    TONNAGE_MISMATCH: 'b-mismatch',
    DUPLICATE: 'b-duplicate',
    MATCH_REVIEW: 'b-review',
  };
  return <span className={`badge ${cls[status]}`}>{MATCH_STATUS_LABEL[status]}</span>;
}

export function SourceBadge({ source }: { source: RecordSource }) {
  return (
    <span className={`badge ${source === 'manual' ? 'b-manual' : 'b-imported'}`}>
      {source === 'manual' ? 'Manual Adjustment' : 'Imported'}
    </span>
  );
}

export function Kpi({
  label, value, sub, tone = '',
}: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`kpi ${tone ? `k-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Card({
  title, sub, right, children, className = '',
}: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div className="card-head">
          <h2>{title}</h2>
          {sub && <span className="sub">{sub}</span>}
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Modal({
  title, steps, children, footer, onClose, narrow,
}: {
  title: ReactNode;
  steps?: { label: string; active: boolean; done: boolean }[];
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  narrow?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${narrow ? 'narrow' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          {steps && (
            <div className="steps">
              {steps.map((s) => (
                <span key={s.label} className={`step ${s.active ? 'active' : s.done ? 'done' : ''}`}>
                  {s.label}
                </span>
              ))}
            </div>
          )}
          <button className="btn small" style={{ marginLeft: 12 }} onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label, children, style,
}: { label: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="field" style={style}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'flat' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `num-${tone}` : ''}`}>{value}</div>
    </div>
  );
}
