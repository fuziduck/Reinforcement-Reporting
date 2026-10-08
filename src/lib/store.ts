/**
 * Data layer. Everything is scoped to a project — data is never mixed between
 * projects. Persisted to localStorage with a typed, immutable store designed to
 * be swapped for an API/DB later (same shape, same actions).
 */
import { useSyncExternalStore } from 'react';
import type {
  AuditAction, AuditEntry, BudgetLine, CostRecord, Delivery, ForecastSettings,
  Id, ImportRecord, MatchLink, MatchOverride, Project,
} from './types';
import { normaliseTicket } from './matching';

export interface Database {
  projects: Project[];
  budget: BudgetLine[];
  deliveries: Delivery[];
  costs: CostRecord[];
  imports: ImportRecord[];
  audit: AuditEntry[];
  links: MatchLink[];
  overrides: MatchOverride[];
  forecasts: Record<Id, ForecastSettings>;
  currentProjectId: Id | null;
  user: string;
}

const STORAGE_KEY = 'rebar-cc-v1';
const EMPTY: Database = {
  projects: [], budget: [], deliveries: [], costs: [], imports: [],
  audit: [], links: [], overrides: [], forecasts: {}, currentProjectId: null,
  user: 'QS User',
};

let state: Database = load();
const listeners = new Set<() => void>();

function load(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Database;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

function commit(next: Database) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full / unavailable — app keeps working in memory
  }
  listeners.forEach((l) => l());
}

export function getState(): Database {
  return state;
}

export function setState(updater: (db: Database) => Database) {
  commit(updater(state));
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDb(): Database {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const uid = (prefix: string): Id =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

// --- Audit ------------------------------------------------------------------

export function logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'user'> & { user?: string }) {
  const full: AuditEntry = {
    id: uid('aud'),
    timestamp: nowIso(),
    user: entry.user ?? state.user,
    ...entry,
  };
  commit({ ...state, audit: [full, ...state.audit] });
}

export function auditChange(args: {
  projectId: Id | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  field: string;
  originalValue: unknown;
  newValue: unknown;
  notes?: string;
}) {
  logAudit({
    projectId: args.projectId,
    action: args.action,
    entity: args.entity,
    entityId: args.entityId,
    field: args.field,
    originalValue: String(args.originalValue ?? ''),
    newValue: String(args.newValue ?? ''),
    notes: args.notes ?? '',
  });
}

// --- Projects ---------------------------------------------------------------

export function addProject(p: Omit<Project, 'id' | 'createdAt'>): Project {
  const project: Project = { ...p, id: uid('prj'), createdAt: nowIso() };
  commit({ ...state, projects: [...state.projects, project], currentProjectId: project.id });
  auditChange({
    projectId: project.id, action: 'CREATE', entity: 'Project', entityId: project.id,
    field: 'project', originalValue: '', newValue: project.name,
  });
  return project;
}

export function updateProject(id: Id, patch: Partial<Project>) {
  const prev = state.projects.find((p) => p.id === id);
  if (!prev) return;
  commit({
    ...state,
    projects: state.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
  for (const [field, value] of Object.entries(patch)) {
    if (String(prev[field as keyof Project] ?? '') !== String(value ?? '')) {
      auditChange({
        projectId: id, action: 'UPDATE', entity: 'Project', entityId: id,
        field, originalValue: prev[field as keyof Project], newValue: value,
      });
    }
  }
}

export function deleteProject(id: Id) {
  const prev = state.projects.find((p) => p.id === id);
  commit({
    ...state,
    projects: state.projects.filter((p) => p.id !== id),
    budget: state.budget.filter((b) => b.projectId !== id),
    deliveries: state.deliveries.filter((d) => d.projectId !== id),
    costs: state.costs.filter((c) => c.projectId !== id),
    imports: state.imports.filter((i) => i.projectId !== id),
    links: state.links.filter((l) => l.projectId !== id),
    overrides: state.overrides.filter((o) => o.projectId !== id),
    forecasts: Object.fromEntries(Object.entries(state.forecasts).filter(([k]) => k !== id)),
    currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
  });
  auditChange({
    projectId: null, action: 'DELETE', entity: 'Project', entityId: id,
    field: 'project', originalValue: prev?.name ?? id, newValue: '(deleted)',
  });
}

export function setCurrentProject(id: Id | null) {
  commit({ ...state, currentProjectId: id });
}

export function setUser(user: string) {
  commit({ ...state, user });
}

// --- Budget -----------------------------------------------------------------

export function addBudgetLines(lines: Omit<BudgetLine, 'id' | 'createdAt' | 'updatedAt' | 'budgetValue'>[]): BudgetLine[] {
  const created: BudgetLine[] = lines.map((l) => ({
    ...l,
    id: uid('bgt'),
    budgetValue: Math.round(l.budgetTonnes * l.budgetRate * 100) / 100,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  commit({ ...state, budget: [...state.budget, ...created] });
  for (const b of created) {
    auditChange({
      projectId: b.projectId,
      action: b.source === 'imported' ? 'IMPORT' : 'CREATE',
      entity: 'BudgetLine', entityId: b.id, field: 'create',
      originalValue: '', newValue: `${b.scheduleRef} ${b.budgetTonnes}t @ £${b.budgetRate}/t`,
    });
  }
  return created;
}

export function updateBudgetLine(id: Id, patch: Partial<BudgetLine>) {
  const prev = state.budget.find((b) => b.id === id);
  if (!prev) return;
  const merged = { ...prev, ...patch, updatedAt: nowIso() };
  merged.budgetValue = Math.round(merged.budgetTonnes * merged.budgetRate * 100) / 100;
  // Never lose the original imported values
  if (patch.budgetTonnes != null && patch.budgetTonnes !== prev.budgetTonnes) merged.importedTonnes = prev.importedTonnes ?? prev.budgetTonnes;
  if (patch.budgetRate != null && patch.budgetRate !== prev.budgetRate) merged.importedRate = prev.importedRate ?? prev.budgetRate;
  merged.source = merged.importedTonnes != null || merged.importedRate != null ? 'manual' : merged.source;
  commit({ ...state, budget: state.budget.map((b) => (b.id === id ? merged : b)) });
  for (const [field, value] of Object.entries(patch)) {
    const before = prev[field as keyof BudgetLine];
    if (String(before ?? '') !== String(value ?? '')) {
      auditChange({
        projectId: prev.projectId, action: 'ADJUSTMENT', entity: 'BudgetLine', entityId: id,
        field, originalValue: before, newValue: value,
        notes: 'Manual adjustment — imported value retained',
      });
    }
  }
}

export function deleteBudgetLine(id: Id) {
  const prev = state.budget.find((b) => b.id === id);
  if (!prev) return;
  commit({ ...state, budget: state.budget.filter((b) => b.id !== id) });
  auditChange({
    projectId: prev.projectId, action: 'DELETE', entity: 'BudgetLine', entityId: id,
    field: 'delete', originalValue: `${prev.scheduleRef} ${prev.budgetTonnes}t`, newValue: '(deleted)',
  });
}

// --- Deliveries / costs -----------------------------------------------------

export function addDeliveries(rows: Omit<Delivery, 'id' | 'ticketNorm' | 'createdAt' | 'updatedAt'>[]): Delivery[] {
  const created: Delivery[] = rows.map((r) => ({
    ...r,
    id: uid('dlv'),
    ticketNorm: normaliseTicket(r.ticketNo),
    importedTonnes: r.importedTonnes ?? r.tonnes,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  commit({ ...state, deliveries: [...state.deliveries, ...created] });
  return created;
}

export function updateDelivery(id: Id, patch: Partial<Delivery>) {
  const prev = state.deliveries.find((d) => d.id === id);
  if (!prev) return;
  const merged: Delivery = {
    ...prev,
    ...patch,
    importedTonnes: prev.importedTonnes ?? prev.tonnes,
    importedTicketNo: prev.importedTicketNo ?? prev.ticketNo,
    ticketNorm: normaliseTicket(patch.ticketNo ?? prev.ticketNo),
    source: 'manual',
    updatedAt: nowIso(),
  };
  commit({ ...state, deliveries: state.deliveries.map((d) => (d.id === id ? merged : d)) });
  for (const [field, value] of Object.entries(patch)) {
    const before = prev[field as keyof Delivery];
    if (String(before ?? '') !== String(value ?? '')) {
      auditChange({
        projectId: prev.projectId, action: 'ADJUSTMENT', entity: 'Delivery', entityId: id,
        field, originalValue: before, newValue: value,
        notes: 'Manual adjustment — imported value retained',
      });
    }
  }
}

export function deleteDelivery(id: Id) {
  const prev = state.deliveries.find((d) => d.id === id);
  if (!prev) return;
  commit({
    ...state,
    deliveries: state.deliveries.filter((d) => d.id !== id),
    links: state.links.filter((l) => l.deliveryId !== id),
  });
  auditChange({
    projectId: prev.projectId, action: 'DELETE', entity: 'Delivery', entityId: id,
    field: 'delete', originalValue: `${prev.ticketNo} ${prev.tonnes}t`, newValue: '(deleted)',
  });
}

export function addCosts(rows: Omit<CostRecord, 'id' | 'ticketNorm' | 'createdAt' | 'updatedAt'>[]): CostRecord[] {
  const created: CostRecord[] = rows.map((r) => ({
    ...r,
    id: uid('cst'),
    ticketNorm: normaliseTicket(r.ticketNo),
    importedTonnes: r.importedTonnes ?? r.costedTonnes,
    importedCost: r.importedCost ?? r.cost,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }));
  commit({ ...state, costs: [...state.costs, ...created] });
  return created;
}

export function updateCost(id: Id, patch: Partial<CostRecord>) {
  const prev = state.costs.find((c) => c.id === id);
  if (!prev) return;
  const merged: CostRecord = {
    ...prev,
    ...patch,
    importedTonnes: prev.importedTonnes ?? prev.costedTonnes,
    importedCost: prev.importedCost ?? prev.cost,
    importedTicketNo: prev.importedTicketNo ?? prev.ticketNo,
    ticketNorm: normaliseTicket(patch.ticketNo ?? prev.ticketNo),
    source: 'manual',
    updatedAt: nowIso(),
  };
  commit({ ...state, costs: state.costs.map((c) => (c.id === id ? merged : c)) });
  for (const [field, value] of Object.entries(patch)) {
    const before = prev[field as keyof CostRecord];
    if (String(before ?? '') !== String(value ?? '')) {
      auditChange({
        projectId: prev.projectId, action: 'ADJUSTMENT', entity: 'CostRecord', entityId: id,
        field, originalValue: before, newValue: value,
        notes: 'Manual adjustment — imported value retained',
      });
    }
  }
}

export function deleteCost(id: Id) {
  const prev = state.costs.find((c) => c.id === id);
  if (!prev) return;
  commit({
    ...state,
    costs: state.costs.filter((c) => c.id !== id),
    links: state.links.filter((l) => l.costId !== id),
  });
  auditChange({
    projectId: prev.projectId, action: 'DELETE', entity: 'CostRecord', entityId: id,
    field: 'delete', originalValue: `${prev.ticketNo} £${prev.cost}`, newValue: '(deleted)',
  });
}

// --- Matching ---------------------------------------------------------------

export function linkRecords(deliveryId: Id, costId: Id) {
  const d = state.deliveries.find((x) => x.id === deliveryId);
  const c = state.costs.find((x) => x.id === costId);
  const link: MatchLink = {
    id: uid('lnk'), projectId: d?.projectId ?? c?.projectId ?? '',
    deliveryId, costId, method: 'manual', createdBy: state.user, createdAt: nowIso(),
  };
  commit({
    ...state,
    links: [
      ...state.links.filter((l) => l.deliveryId !== deliveryId && l.costId !== costId),
      link,
    ],
  });
  auditChange({
    projectId: link.projectId, action: 'MATCH', entity: 'Match', entityId: link.id,
    field: 'match', originalValue: `${d?.ticketNo ?? '(none)'} / ${c?.ticketNo ?? '(none)'}`,
    newValue: 'manually matched', notes: `Delivery ${d?.tonnes}t ↔ Cost ${c?.costedTonnes}t £${c?.cost}`,
  });
}

export function unlinkRecords(deliveryId: Id, costId: Id) {
  const removed = state.links.filter((l) => l.deliveryId === deliveryId && l.costId === costId);
  commit({ ...state, links: state.links.filter((l) => !(l.deliveryId === deliveryId && l.costId === costId)) });
  for (const l of removed) {
    auditChange({
      projectId: l.projectId, action: 'UNMATCH', entity: 'Match', entityId: l.id,
      field: 'match', originalValue: `${deliveryId} ↔ ${costId}`, newValue: '(unmatched)',
    });
  }
}

export function addOverride(o: Omit<MatchOverride, 'id' | 'createdAt' | 'createdBy'>) {
  const entry: MatchOverride = { ...o, id: uid('ovr'), createdAt: nowIso(), createdBy: state.user };
  commit({
    ...state,
    overrides: [...state.overrides.filter((x) => x.target !== o.target), entry],
  });
  auditChange({
    projectId: o.projectId, action: 'UPDATE', entity: 'MatchStatus', entityId: o.target,
    field: 'status', originalValue: '(derived)', newValue: o.status, notes: o.note,
  });
}

// --- Forecast ---------------------------------------------------------------

export function defaultForecast(projectId: Id): ForecastSettings {
  return {
    projectId, method: 'actual', manualRate: null,
    scheduleOverrides: {}, forecastTonnesOverride: {}, accrualOverride: {},
    updatedAt: nowIso(),
  };
}

export function getForecast(projectId: Id): ForecastSettings {
  return state.forecasts[projectId] ?? defaultForecast(projectId);
}

export function setForecast(projectId: Id, patch: Partial<ForecastSettings>) {
  const prev = getForecast(projectId);
  const next: ForecastSettings = { ...prev, ...patch, projectId, updatedAt: nowIso() };
  commit({ ...state, forecasts: { ...state.forecasts, [projectId]: next } });
  auditChange({
    projectId, action: 'FORECAST_CHANGE', entity: 'Forecast', entityId: projectId,
    field: patch.scheduleOverrides ? 'schedule forecast rate' : patch.manualRate != null ? 'manual rate' : 'forecast method',
    originalValue: patch.scheduleOverrides ? '(see schedule)' : `${prev.method} ${prev.manualRate ?? ''}`,
    newValue: patch.scheduleOverrides ? '(see schedule)' : `${next.method} ${next.manualRate ?? ''}`,
  });
}

// --- Imports ----------------------------------------------------------------

export function addImport(rec: Omit<ImportRecord, 'id' | 'importedAt'>): ImportRecord {
  const full: ImportRecord = { ...rec, id: uid('imp'), importedAt: nowIso() };
  commit({ ...state, imports: [full, ...state.imports] });
  auditChange({
    projectId: rec.projectId, action: 'IMPORT', entity: 'Import', entityId: full.id,
    field: 'import', originalValue: '', newValue: `${rec.type} import "${rec.fileName}" — ${rec.imported} of ${rec.totalRows} rows`,
    notes: rec.notes,
  });
  return full;
}

// --- Reset / seed -----------------------------------------------------------

export function replaceDatabase(db: Database) {
  commit({ ...EMPTY, ...db });
}
