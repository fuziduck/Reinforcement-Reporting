// ---------------------------------------------------------------------------
// Core domain types — reinforcement quantity, budget, cost & commercial control
// ---------------------------------------------------------------------------

export type Id = string;

export type ProjectStatus = 'Planning' | 'Active' | 'On Hold' | 'Complete' | 'Closed';

export interface Project {
  id: Id;
  name: string;
  number: string;
  client: string;
  mainContractor: string;
  startDate: string; // ISO yyyy-mm-dd
  completionDate: string;
  status: ProjectStatus;
  createdAt: string;
}

/** How a record entered the system — never overwritten silently. */
export type RecordSource = 'imported' | 'manual';

/** Budget line — original commercial allowance (source 1). */
export interface BudgetLine {
  id: Id;
  projectId: Id;
  scheduleRef: string;
  location: string;
  element: string;
  description: string;
  budgetTonnes: number;
  budgetRate: number; // £/tonne
  budgetValue: number; // budgetTonnes × budgetRate (calculated)
  supplier: string;
  package: string;
  phase: string;
  area: string;
  notes: string;
  source: RecordSource;
  importId?: Id;
  // Retain the original imported values even after manual adjustment
  importedTonnes?: number;
  importedRate?: number;
  createdAt: string;
  updatedAt: string;
}

/** Site delivery / call-off record (source 2). */
export interface Delivery {
  id: Id;
  projectId: Id;
  deliveryDate: string;
  ticketNo: string;
  ticketNorm: string; // normalised ticket for matching
  scheduleRef: string;
  location: string;
  element: string;
  area: string;
  package: string;
  phase: string;
  tonnes: number;
  description: string;
  supplier: string;
  source: RecordSource;
  importId?: Id;
  importedTonnes?: number;
  importedTicketNo?: string;
  raw: Record<string, string>; // original imported row, retained verbatim
  createdAt: string;
  updatedAt: string;
}

/** External cost record from the procurement/commercial system (source 3). */
export interface CostRecord {
  id: Id;
  projectId: Id;
  costDate: string;
  ticketNo: string;
  ticketNorm: string;
  costedTonnes: number;
  cost: number; // £
  supplier: string;
  costRef: string;
  source: RecordSource;
  importId?: Id;
  importedTonnes?: number;
  importedCost?: number;
  importedTicketNo?: string;
  raw: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

// --- Reconciliation ---------------------------------------------------------

export type MatchStatus =
  | 'COSTED'
  | 'DELIVERED_UNCOSTED'
  | 'COST_NO_DELIVERY'
  | 'TONNAGE_MISMATCH'
  | 'DUPLICATE'
  | 'MATCH_REVIEW';

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  COSTED: 'Costed',
  DELIVERED_UNCOSTED: 'Delivered – Uncosted',
  COST_NO_DELIVERY: 'Cost Record – No Delivery',
  TONNAGE_MISMATCH: 'Tonnage Mismatch',
  DUPLICATE: 'Duplicate',
  MATCH_REVIEW: 'Match Review',
};

/** A link between one delivery and one cost record (system or manual). */
export interface MatchLink {
  id: Id;
  projectId: Id;
  deliveryId: Id;
  costId: Id;
  method: 'system' | 'manual';
  createdBy: string;
  createdAt: string;
}

/** Manual match-status / accrual adjustments that override derived status. */
export interface MatchOverride {
  id: Id;
  projectId: Id;
  /** 'delivery:<id>' or 'cost:<id>' */
  target: string;
  status: MatchStatus | 'CLEAR';
  note: string;
  createdBy: string;
  createdAt: string;
}

/** One row of the reconciliation view (delivery ⟷ cost pair). */
export interface ReconciliationRow {
  deliveryId?: Id;
  costId?: Id;
  deliveryDate: string;
  ticketNo: string;
  ticketNorm: string;
  scheduleRef: string;
  location: string;
  supplier: string;
  deliveredTonnes: number | null;
  costDate: string;
  costedTonnes: number | null;
  cost: number | null;
  costRef: string;
  actualRate: number | null; // cost ÷ costed tonnes
  status: MatchStatus;
  tonnageVariance: number | null; // costed − delivered
  tonnageVariancePct: number | null;
  matchMethod: 'system' | 'manual' | 'none';
  notes: string;
}

// --- Forecast ---------------------------------------------------------------

export type ForecastMethod = 'budget' | 'actual' | 'manual';

export const FORECAST_METHOD_LABEL: Record<ForecastMethod, string> = {
  budget: 'Budget Rate',
  actual: 'Current Actual Rate',
  manual: 'Manual Forecast Rate',
};

export interface ForecastSettings {
  projectId: Id;
  method: ForecastMethod;
  manualRate: number | null; // project-wide manual £/t
  /** Per-schedule overrides: scheduleRef → settings */
  scheduleOverrides: Record<string, { method: ForecastMethod; manualRate: number | null }>;
  forecastTonnesOverride: Record<string, number>; // scheduleRef → forecast final tonnes
  accrualOverride: Record<string, number>; // scheduleRef → manual accrual £
  updatedAt: string;
}

// --- Imports ----------------------------------------------------------------

export type ImportType = 'budget' | 'delivery' | 'cost';

export interface ImportRecord {
  id: Id;
  projectId: Id;
  type: ImportType;
  fileName: string;
  importedAt: string;
  user: string;
  columnMap: Record<string, string>; // source column → app field
  totalRows: number;
  imported: number;
  rejected: number;
  duplicates: number;
  exceptions: number;
  notes: string;
}

// --- Audit ------------------------------------------------------------------

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'IMPORT'
  | 'MATCH'
  | 'UNMATCH'
  | 'FORECAST_CHANGE'
  | 'ADJUSTMENT';

export interface AuditEntry {
  id: Id;
  projectId: Id | null;
  user: string;
  timestamp: string;
  action: AuditAction;
  entity: string; // e.g. 'BudgetLine', 'Delivery', 'CostRecord', 'Forecast'
  entityId: string;
  field: string;
  originalValue: string;
  newValue: string;
  notes: string;
}

// --- Commercial aggregation -------------------------------------------------

/** Commercial position of a group (schedule / location / …). */
export interface CommercialLine {
  key: string; // group key, e.g. schedule ref
  label: string;
  budgetTonnes: number;
  budgetRate: number; // weighted
  budgetValue: number;
  deliveredTonnes: number;
  costedTonnes: number;
  uncostedTonnes: number; // accrued quantity
  remainingTonnes: number; // budget − delivered (signed: negative = over-delivered)
  forecastFinalTonnes: number;
  actualCost: number;
  actualRate: number; // actual £/costed tonne
  accruedCost: number; // uncosted × forecast rate (or override)
  futureCost: number; // remaining × forecast rate (floor 0)
  forecastFinalCost: number;
  forecastRate: number;
  forecastRateMethod: ForecastMethod;
  forecastRateSource: string;
  costVariance: number; // forecast final − budget
  costVariancePct: number;
  rateVariance: number; // forecast rate − budget rate
  rateVariancePct: number;
  identityOk: boolean; // budget = costed + accrued + remaining (±0.001)
  overDelivered: boolean;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  kind: string;
  message: string;
  targets: string[]; // entity ids
}

export interface ExceptionItem {
  kind:
    | 'DELIVERED_UNCOSTED'
    | 'COST_NO_DELIVERY'
    | 'DUPLICATE_TICKET'
    | 'DUPLICATE_COST'
    | 'TONNAGE_MISMATCH'
    | 'MISSING_TICKET'
    | 'MISSING_SCHEDULE'
    | 'MISSING_LOCATION'
    | 'RATE_HIGH'
    | 'RATE_LOW';
  label: string;
  description: string;
  count: number;
  tonnes: number;
  value: number;
}
