/** Derived project data: reconciliation rows, commercial lines, exceptions. */
import { useMemo } from 'react';
import { useDb } from './store';
import { reconcile } from './matching';
import { buildExceptions, computeLines, totalLine, validateIdentities, type ExceptionDetail, type GroupBy } from './commercial';
import type {
  CommercialLine, ExceptionItem, ForecastSettings,
  Project, ReconciliationRow, ValidationIssue,
} from './types';
import { defaultForecast } from './store';

export interface ProjectData {
  project: Project | null;
  budget: ReturnType<typeof useDb>['budget'];
  deliveries: ReturnType<typeof useDb>['deliveries'];
  costs: ReturnType<typeof useDb>['costs'];
  imports: ReturnType<typeof useDb>['imports'];
  audit: ReturnType<typeof useDb>['audit'];
  forecast: ForecastSettings;
  rows: ReconciliationRow[];
  scheduleLines: CommercialLine[];
  totals: CommercialLine;
  groupLines: (g: GroupBy) => CommercialLine[];
  exceptions: ExceptionItem[];
  exceptionDetails: ExceptionDetail[];
  issues: ValidationIssue[];
  orphanCostValue: number;
  orphanCostCount: number;
}

export function useProjectData(): ProjectData {
  const db = useDb();
  const projectId = db.currentProjectId;

  return useMemo(() => {
    const project = db.projects.find((p) => p.id === projectId) ?? null;
    const budget = db.budget.filter((b) => b.projectId === projectId);
    const deliveries = db.deliveries.filter((d) => d.projectId === projectId);
    const costs = db.costs.filter((c) => c.projectId === projectId);
    const imports = db.imports.filter((i) => i.projectId === projectId);
    const audit = db.audit.filter((a) => a.projectId === projectId || a.projectId === null);
    const forecast = (projectId && db.forecasts[projectId]) || defaultForecast(projectId ?? '');

    const { rows } = projectId
      ? reconcile(projectId, db.deliveries, db.costs, db.links, db.overrides)
      : { rows: [] as ReconciliationRow[] };

    const scheduleLines = computeLines({ budgetLines: budget, rows, deliveries, forecast, groupBy: 'schedule' });
    const totals = totalLine(scheduleLines);
    const groupLines = (g: GroupBy) =>
      g === 'schedule'
        ? scheduleLines
        : computeLines({ budgetLines: budget, rows, deliveries, forecast, groupBy: g });
    const { items, details } = buildExceptions(rows, deliveries, costs);
    const issues = validateIdentities(scheduleLines, rows, deliveries, costs);
    const orphans = rows.filter((r) => !r.deliveryId && r.costId);

    return {
      project, budget, deliveries, costs, imports, audit, forecast, rows,
      scheduleLines, totals, groupLines, exceptions: items, exceptionDetails: details, issues,
      orphanCostValue: orphans.reduce((a, r) => a + (r.cost ?? 0), 0),
      orphanCostCount: orphans.length,
    };
  }, [db]);
}

export function rowsForSchedule(rows: ReconciliationRow[], scheduleRef: string): ReconciliationRow[] {
  return rows.filter((r) => r.scheduleRef === scheduleRef);
}
