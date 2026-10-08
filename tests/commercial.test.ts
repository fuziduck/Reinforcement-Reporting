import { describe, expect, it } from 'vitest';
import { computeLines, resolveForecastRate, totalLine, validateIdentities } from '../src/lib/commercial';
import { reconcile } from '../src/lib/matching';
import type { BudgetLine, CostRecord, Delivery, ForecastSettings } from '../src/lib/types';

const forecast = (patch: Partial<ForecastSettings> = {}): ForecastSettings => ({
  projectId: 'p1', method: 'budget', manualRate: null,
  scheduleOverrides: {}, forecastTonnesOverride: {}, accrualOverride: {},
  updatedAt: '', ...patch,
});

const delivery = (id: string, ticket: string, tonnes: number, sched = 'S201'): Delivery => ({
  id, projectId: 'p1', deliveryDate: '2026-05-01', ticketNo: ticket,
  ticketNorm: ticket, scheduleRef: sched, location: 'Core A', element: 'Core walls',
  area: 'A', package: 'Sup', phase: 'P1', tonnes, description: '', supplier: 'Careys',
  source: 'imported', raw: {}, createdAt: '', updatedAt: '',
});

const cost = (id: string, ticket: string, costedTonnes: number, value: number): CostRecord => ({
  id, projectId: 'p1', costDate: '2026-06-01', ticketNo: ticket, ticketNorm: ticket,
  costedTonnes, cost: value, supplier: 'Careys', costRef: 'INV', source: 'imported',
  raw: {}, createdAt: '', updatedAt: '',
});

const budgetLine = (tonnes: number, rate: number, sched = 'S201'): BudgetLine => ({
  id: `b-${sched}`, projectId: 'p1', scheduleRef: sched, location: 'Core A', element: 'Core walls',
  description: 'Core walls', budgetTonnes: tonnes, budgetRate: rate,
  budgetValue: Math.round(tonnes * rate * 100) / 100, supplier: 'Careys', package: 'Sup',
  phase: 'P1', area: 'A', notes: '', source: 'imported', createdAt: '', updatedAt: '',
});

/**
 * Worked example (spec §9/§10) — S201: 420t @ £1,050 = £441,000;
 * delivered 310t (285t costed + 25t uncosted); actual cost £309,000.
 */
function workedExample(method: ForecastSettings['method'] = 'actual') {
  const budget = [budgetLine(420, 1050)];
  const deliveries = [
    delivery('d1', 'CARE-1', 160),
    delivery('d2', 'CARE-2', 125), // matched → costed 285t
    delivery('d3', 'CARE-3', 25), // uncosted → accrual 25t
  ];
  const costs = [cost('c1', 'CARE-1', 160, 173000), cost('c2', 'CARE-2', 125, 136000)];
  const { rows } = reconcile('p1', deliveries, costs, [], []);
  const fc = forecast({ method });
  const lines = computeLines({ budgetLines: budget, rows, deliveries, forecast: fc, groupBy: 'schedule' });
  return { lines, line: lines[0], rows, deliveries, costs, fc };
}

describe('commercial engine — worked S201 example', () => {
  it('reconciles quantities exactly as Budget = Costed + Accrued + Remaining', () => {
    const { line } = workedExample();
    expect(line.budgetTonnes).toBe(420);
    expect(line.deliveredTonnes).toBe(310);
    expect(line.costedTonnes).toBe(285);
    expect(line.uncostedTonnes).toBe(25); // accrued — NOT future quantity
    expect(line.remainingTonnes).toBe(110);
    expect(line.budgetValue).toBe(441000);
    expect(line.actualCost).toBe(309000);
    expect(line.identityOk).toBe(true);
  });

  it('uses the actual costed rate for accrual and future cost (Option 2)', () => {
    const { line } = workedExample('actual');
    expect(line.actualRate).toBeCloseTo(1084.21, 1); // £309,000 ÷ 285t
    expect(line.accruedCost).toBeCloseTo(27100, -2); // 25t × £1,084/t ≈ £27,100
    expect(line.futureCost).toBeCloseTo(119240, -2); // 110t × £1,084/t ≈ £119,240
    expect(line.forecastFinalCost).toBeCloseTo(455340, -2); // ≈ £455,340
    expect(line.costVariance).toBeCloseTo(14340, -2); // +£14,340
    expect(line.costVariancePct).toBeCloseTo(3.25, 1); // +3.25%
  });

  it('Option 1 (budget rate) and Option 3 (manual rate) change the forecast, never the actuals', () => {
    const budgetCase = workedExample('budget');
    expect(budgetCase.line.forecastRate).toBe(1050);
    expect(budgetCase.line.accruedCost).toBe(26250); // 25t × £1,050
    expect(budgetCase.line.futureCost).toBe(115500); // 110t × £1,050
    expect(budgetCase.line.forecastFinalCost).toBe(450750); // 309,000 + 26,250 + 115,500
    expect(budgetCase.line.actualCost).toBe(309000);

    const manualCase = (() => {
      const { lines, rows, deliveries, costs } = workedExample('manual');
      const fc = forecast({ method: 'manual', manualRate: 1100 });
      const l = computeLines({ budgetLines: [budgetLine(420, 1050)], rows, deliveries, forecast: fc, groupBy: 'schedule' })[0];
      return l;
    })();
    expect(manualCase.forecastRate).toBe(1100);
    expect(manualCase.accruedCost).toBe(27500);
    expect(manualCase.futureCost).toBe(121000);
    expect(manualCase.forecastFinalCost).toBe(457500);
  });

  it('supports a manual accrual estimate override', () => {
    const { rows, deliveries } = workedExample('actual');
    const fc = forecast({ method: 'actual', accrualOverride: { S201: 30000 } });
    const l = computeLines({ budgetLines: [budgetLine(420, 1050)], rows, deliveries, forecast: fc, groupBy: 'schedule' })[0];
    expect(l.accruedCost).toBe(30000);
    expect(l.forecastFinalCost).toBeCloseTo(l.actualCost + 30000 + l.futureCost, 6);
  });

  it('falls back to the budget rate when there are no costed tonnes', () => {
    const r = resolveForecastRate(forecast({ method: 'actual' }), 'S201', 1050, null);
    expect(r.rate).toBe(1050);
  });
});

describe('quantity identities', () => {
  it('never counts accrued tonnes as remaining/future', () => {
    const budget = [budgetLine(1000, 1000)];
    const deliveries = [
      delivery('d1', 'A', 550), delivery('d2', 'B', 50), // 600t delivered, 50t uncosted
    ];
    const costs = [cost('c1', 'A', 550, 550000)];
    const { rows } = reconcile('p1', deliveries, costs, [], []);
    const l = computeLines({ budgetLines: budget, rows, deliveries, forecast: forecast(), groupBy: 'schedule' })[0];
    expect(l.deliveredTonnes).toBe(600);
    expect(l.costedTonnes).toBe(550);
    expect(l.uncostedTonnes).toBe(50);
    expect(l.remainingTonnes).toBe(400); // 1,000 − 600 (the 50t accrued stays delivered)
    expect(l.forecastFinalTonnes).toBe(1000);
  });

  it('flags over-delivery and broken identities', () => {
    const budget = [budgetLine(100, 1000)];
    const deliveries = [delivery('d1', 'A', 140)];
    const costs = [cost('c1', 'A', 140, 140000)];
    const { rows } = reconcile('p1', deliveries, costs, [], []);
    const l = computeLines({ budgetLines: budget, rows, deliveries, forecast: forecast(), groupBy: 'schedule' })[0];
    expect(l.overDelivered).toBe(true);
    const issues = validateIdentities([l], rows, deliveries, costs);
    expect(issues.some((i) => i.kind === 'OVER_DELIVERY')).toBe(true);
    // The identity still holds arithmetically: budget = costed + accrued + remaining
    expect(l.budgetTonnes).toBeCloseTo(l.costedTonnes + l.uncostedTonnes + l.remainingTonnes, 6);
  });

  it('rolls up project totals across schedules', () => {
    const budget = [budgetLine(420, 1050), budgetLine(380, 1050, 'S202')];
    const deliveries = [
      delivery('d1', 'A', 285), delivery('d1b', 'C', 25), // S201: 310t delivered (25t uncosted)
      delivery('d2', 'B', 275, 'S202'), delivery('d2b', 'D', 15, 'S202'), // S202: 290t delivered
    ];
    const costs = [cost('c1', 'A', 285, 309000), cost('c2', 'B', 275, 300000)];
    const { rows } = reconcile('p1', deliveries, costs, [], []);
    const lines = computeLines({ budgetLines: budget, rows, deliveries, forecast: forecast(), groupBy: 'schedule' });
    const t = totalLine(lines);
    expect(t.budgetTonnes).toBe(800);
    expect(t.deliveredTonnes).toBe(600);
    expect(t.budgetValue).toBe(840000);
    expect(t.actualCost).toBe(609000);
    expect(t.identityOk).toBe(true);
    // Accrued roll-up: 25t + 15t uncosted
    expect(t.uncostedTonnes).toBe(40);
  });
});
