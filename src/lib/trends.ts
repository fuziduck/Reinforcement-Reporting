/** Time-series aggregation for trend charts (Dashboard + Reports). */
import type { BudgetLine, CostRecord, Delivery, ReconciliationRow } from './types';
import { monthKey, monthLabel } from './format';

export interface Trends {
  months: string[]; // yyyy-mm
  labels: string[];
  budgetTonnes: number;
  budgetValue: number;
  budgetRate: number;
  cumDelivered: number[];
  cumBudgetLine: number[];
  cumBudgetValueLine: number[];
  monthlyDelivered: number[];
  monthlyCost: number[];
  cumCost: number[];
  cumForecast: (number | null)[]; // actual to date, dashed to forecast final at end
  forecastFinalCost: number;
  monthlyActualRate: (number | null)[];
  budgetRateLine: number[];
  monthCostedTonnes: number[];
}

export function buildTrends(args: {
  budget: BudgetLine[];
  deliveries: Delivery[];
  costs: CostRecord[];
  rows: ReconciliationRow[];
  forecastFinalCost: number;
}): Trends {
  const { budget, deliveries, costs, rows, forecastFinalCost } = args;
  const budgetTonnes = budget.reduce((a, b) => a + b.budgetTonnes, 0);
  const budgetValue = budget.reduce((a, b) => a + b.budgetValue, 0);
  const budgetRate = budgetTonnes > 0 ? budgetValue / budgetTonnes : 0;

  const dates = [
    ...deliveries.map((d) => d.deliveryDate),
    ...costs.map((c) => c.costDate),
  ].filter(Boolean).sort();
  const first = dates[0] ?? new Date().toISOString().slice(0, 10);
  const last = dates[dates.length - 1] ?? first;
  const months: string[] = [];
  {
    let [y, m] = first.slice(0, 7).split('-').map(Number);
    const [ey, em] = last.slice(0, 7).split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
      if (months.length > 120) break;
    }
  }
  const idx = new Map(months.map((m, i) => [m, i]));
  const n = months.length;

  const monthlyDelivered = new Array(n).fill(0);
  for (const d of deliveries) {
    const i = idx.get(monthKey(d.deliveryDate));
    if (i != null) monthlyDelivered[i] += d.tonnes;
  }
  const monthlyCost = new Array(n).fill(0);
  const monthCostedTonnes = new Array(n).fill(0);
  for (const r of rows) {
    if (!r.costId || !r.costDate || r.status === 'DELIVERED_UNCOSTED') continue;
    const i = idx.get(monthKey(r.costDate));
    if (i != null) {
      monthlyCost[i] += r.cost ?? 0;
      monthCostedTonnes[i] += r.deliveredTonnes ?? 0;
    }
  }

  let acc = 0;
  const cumDelivered = monthlyDelivered.map((v) => (acc += v));
  let accCost = 0;
  const cumCost = monthlyCost.map((v) => (accCost += v));
  const cumBudgetLine = new Array(n).fill(budgetTonnes);
  const cumBudgetValueLine = new Array(n).fill(budgetValue);
  const budgetRateLine = new Array(n).fill(budgetRate);
  const monthlyActualRate = monthlyCost.map((c, i) =>
    monthCostedTonnes[i] > 0 ? c / monthCostedTonnes[i] : null,
  );

  // Forecast path: actual cumulative to date, then dashed to forecast final
  const cumForecast: (number | null)[] = cumCost.map((v) => v);
  if (n > 0 && forecastFinalCost > 0) {
    cumForecast.push(forecastFinalCost);
  }
  const labels = months.map(monthLabel);
  if (cumForecast.length > n) labels.push('Forecast');

  return {
    months, labels, budgetTonnes, budgetValue, budgetRate,
    cumDelivered, cumBudgetLine, cumBudgetValueLine,
    monthlyDelivered, monthlyCost, cumCost, cumForecast, forecastFinalCost,
    monthlyActualRate, budgetRateLine, monthCostedTonnes,
  };
}
