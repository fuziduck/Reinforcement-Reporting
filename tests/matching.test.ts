import { describe, expect, it } from 'vitest';
import { isTonnageMismatch, normaliseTicket, reconcile } from '../src/lib/matching';
import type { CostRecord, Delivery } from '../src/lib/types';

const delivery = (id: string, ticket: string, tonnes: number): Delivery => ({
  id, projectId: 'p1', deliveryDate: '2026-05-01', ticketNo: ticket,
  ticketNorm: normaliseTicket(ticket), scheduleRef: 'S201', location: 'Core A',
  element: 'Core walls', area: 'A', package: 'Sup', phase: 'P1', tonnes,
  description: '', supplier: 'Careys', source: 'imported', raw: {}, createdAt: '', updatedAt: '',
});

const cost = (id: string, ticket: string, costedTonnes: number, value: number): CostRecord => ({
  id, projectId: 'p1', costDate: '2026-06-01', ticketNo: ticket, ticketNorm: normaliseTicket(ticket),
  costedTonnes, cost: value, supplier: 'Careys', costRef: 'INV-1', source: 'imported',
  raw: {}, createdAt: '', updatedAt: '',
});

describe('normaliseTicket', () => {
  it('tolerates spaces, case and punctuation', () => {
    expect(normaliseTicket(' CARE-000123 ')).toBe(normaliseTicket('care 123'));
    expect(normaliseTicket('CARE-123')).toBe('CARE123');
    expect(normaliseTicket('tk 123 a')).toBe(normaliseTicket('TK-000123-A'));
  });

  it('collapses numeric vs text formatting and leading zeroes', () => {
    expect(normaliseTicket('000123')).toBe(normaliseTicket('123'));
    expect(normaliseTicket('123.0')).toBe(normaliseTicket('123'));
    expect(normaliseTicket('RNL-0000456')).toBe(normaliseTicket('RNL 456'));
  });

  it('is empty-safe', () => {
    expect(normaliseTicket('')).toBe('');
  });
});

describe('isTonnageMismatch', () => {
  it('tolerates small variances (max of 0.5t or 2%)', () => {
    expect(isTonnageMismatch(100, 101.5)).toBe(false);
    expect(isTonnageMismatch(5, 5.4)).toBe(false);
    expect(isTonnageMismatch(100, 105)).toBe(true);
    expect(isTonnageMismatch(5, 6)).toBe(true);
  });
});

describe('reconcile', () => {
  it('auto-matches unique tickets across formatting differences → COSTED', () => {
    const { rows, links } = reconcile('p1', [delivery('d1', 'CARE-000142', 12.5)], [cost('c1', 'care 142', 12.5, 13000)], [], []);
    expect(links).toHaveLength(1);
    expect(rows.find((r) => r.deliveryId === 'd1')?.status).toBe('COSTED');
  });

  it('flags tonnage mismatch when variances are material', () => {
    const { rows } = reconcile('p1', [delivery('d1', 'CARE-1', 10)], [cost('c1', 'CARE-1', 13, 14000)], [], []);
    expect(rows.find((r) => r.deliveryId === 'd1')?.status).toBe('TONNAGE_MISMATCH');
  });

  it('leaves uncosted deliveries unmatched and reports orphan costs', () => {
    const { rows, links } = reconcile(
      'p1',
      [delivery('d1', 'CARE-1', 10)],
      [cost('c1', 'RNL-9', 8, 8000)],
      [], [],
    );
    expect(links).toHaveLength(0);
    expect(rows.find((r) => r.deliveryId === 'd1')?.status).toBe('DELIVERED_UNCOSTED');
    expect(rows.find((r) => r.costId === 'c1')?.status).toBe('COST_NO_DELIVERY');
  });

  it('flags duplicate tickets and never auto-matches them', () => {
    const { links, rows } = reconcile(
      'p1',
      [delivery('d1', 'CARE-7', 10), delivery('d2', 'care-0007', 6)],
      [cost('c1', 'CARE-7', 10, 10000), cost('c2', 'CARE-7', 6, 6000)],
      [], [],
    );
    expect(links.filter((l) => l.method === 'system')).toHaveLength(0);
    expect(rows.find((r) => r.deliveryId === 'd1')?.status).toBe('DUPLICATE');
    expect(rows.find((r) => r.costId === 'c1')?.status).toBe('DUPLICATE');
  });

  it('flags ambiguous near-miss tickets for MATCH_REVIEW instead of guessing', () => {
    const { links, rows } = reconcile(
      'p1',
      [delivery('d1', 'TK-123-A', 10)],
      [cost('c1', 'TK-123-B', 10, 10000)],
      [], [],
    );
    expect(links).toHaveLength(0);
    expect(rows.find((r) => r.deliveryId === 'd1')?.status).toBe('MATCH_REVIEW');
  });

  it('honours manual links before auto-matching', () => {
    const manual = [{
      id: 'l1', projectId: 'p1', deliveryId: 'd2', costId: 'c2', method: 'manual' as const,
      createdBy: 'QS', createdAt: '',
    }];
    const { links, rows } = reconcile(
      'p1',
      [delivery('d1', 'CARE-1', 5), delivery('d2', 'CARE-2', 7)],
      [cost('c1', 'CARE-1', 5, 5000), cost('c2', 'CARE-2', 7, 7000)],
      manual, [],
    );
    expect(rows.find((r) => r.deliveryId === 'd2')?.matchMethod).toBe('manual');
    expect(links.filter((l) => l.method === 'system').map((l) => l.deliveryId)).toEqual(['d1']);
  });
});
