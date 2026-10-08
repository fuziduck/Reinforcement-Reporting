/**
 * Initial test data (§29). Deterministic (seeded PRNG) so tests are stable.
 *
 * Test project “Aldgate Square – RC Frame” carries deliberately imperfect data:
 *   deliveries without costs, costs without deliveries, duplicate tickets
 *   (delivery + cost), tonnage mismatches, missing tickets/schedules/locations,
 *   rate outliers, mixed ticket formats and dates, several schedules & rates.
 * A second, tiny project proves data isolation between projects.
 */
import type { BudgetLine, CostRecord, Delivery, ImportRecord, Project } from './types';
import type { Database } from './store';
import { normaliseTicket } from './matching';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScheduleSeed {
  ref: string; location: string; element: string; description: string;
  tonnes: number; rate: number; supplier: string; pkg: string; phase: string; area: string;
  split: number; // budget lines
}

const SCHEDULES: ScheduleSeed[] = [
  { ref: 'S101', location: 'Pile Caps', element: 'Foundations', description: 'Pile cap reinforcement', tonnes: 300, rate: 980, supplier: 'Careys', pkg: 'Substructure', phase: 'Phase 1', area: 'Zone A', split: 2 },
  { ref: 'S102', location: 'Ground Beams', element: 'Foundations', description: 'Ground beam cages', tonnes: 180, rate: 990, supplier: 'Careys', pkg: 'Substructure', phase: 'Phase 1', area: 'Zone A', split: 1 },
  { ref: 'S201', location: 'Core A', element: 'Core walls', description: 'Core walls – Core A', tonnes: 420, rate: 1050, supplier: 'Careys', pkg: 'Superstructure', phase: 'Phase 1', area: 'Zone A', split: 2 },
  { ref: 'S202', location: 'Core B', element: 'Core walls', description: 'Core walls – Core B', tonnes: 380, rate: 1050, supplier: 'Careys', pkg: 'Superstructure', phase: 'Phase 1', area: 'Zone B', split: 2 },
  { ref: 'S301', location: 'Level 01', element: 'Slabs', description: 'Slab reinforcement – Level 01', tonnes: 250, rate: 1020, supplier: 'RNdliffe', pkg: 'Superstructure', phase: 'Phase 1', area: 'Zone B', split: 1 },
  { ref: 'S302', location: 'Level 02', element: 'Slabs', description: 'Slab reinforcement – Level 02', tonnes: 250, rate: 1020, supplier: 'RNdliffe', pkg: 'Superstructure', phase: 'Phase 1', area: 'Zone B', split: 1 },
  { ref: 'S303', location: 'Level 03', element: 'Slabs', description: 'Slab reinforcement – Level 03', tonnes: 240, rate: 1020, supplier: 'RNdliffe', pkg: 'Superstructure', phase: 'Phase 2', area: 'Zone B', split: 2 },
  { ref: 'S401', location: 'Level 01', element: 'Columns', description: 'Column starters & cages – L01', tonnes: 120, rate: 1080, supplier: 'Careys', pkg: 'Superstructure', phase: 'Phase 1', area: 'Zone C', split: 1 },
  { ref: 'S402', location: 'Level 02', element: 'Columns', description: 'Column cages – L02', tonnes: 115, rate: 1080, supplier: 'Careys', pkg: 'Superstructure', phase: 'Phase 2', area: 'Zone C', split: 1 },
  { ref: 'S501', location: 'Roof', element: 'Roof', description: 'Roof slab & upstands', tonnes: 90, rate: 1100, supplier: 'RNdliffe', pkg: 'Roof', phase: 'Phase 2', area: 'Zone C', split: 1 },
  { ref: 'S601', location: 'Stairs / Lifts', element: 'Stairs & cores', description: 'Stair & lift core reinforcement', tonnes: 70, rate: 1120, supplier: 'Careys', pkg: 'Finishes Interface', phase: 'Phase 2', area: 'Zone A', split: 1 },
];

const rndDate = (rng: () => number, start: string, end: string): string => {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return new Date(s + rng() * (e - s)).toISOString().slice(0, 10);
};

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Split total into n roughly even random tonnages (2dp) that sum to total. */
function distribute(total: number, n: number, rng: () => number): number[] {
  const weights = Array.from({ length: n }, () => 0.5 + rng());
  const wsum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.round((total * w) / wsum * 100) / 100);
  const diff = Math.round((total - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  out[out.length - 1] = Math.round((out[out.length - 1] + diff) * 100) / 100;
  return out;
}

export function buildSeedDatabase(existing: Partial<Database> = {}): Database {
  const rng = mulberry32(20260924);
  const ts = new Date().toISOString();

  const project: Project = {
    id: 'prj-aldgate',
    name: 'Aldgate Square – RC Frame',
    number: 'AS-2026-014',
    client: 'Meridian Estates',
    mainContractor: 'Hartwell Construction',
    startDate: '2026-03-02',
    completionDate: '2027-06-30',
    status: 'Active',
    createdAt: ts,
  };
  const project2: Project = {
    id: 'prj-riverside',
    name: 'Riverside Tower – Phase 2',
    number: 'RT-2026-021',
    client: 'Dockland Living LLP',
    mainContractor: 'Hartwell Construction',
    startDate: '2026-06-01',
    completionDate: '2027-11-30',
    status: 'Planning',
    createdAt: ts,
  };

  // --- Budget (12+ lines across 11 schedules) --------------------------------
  const budget: BudgetLine[] = [];
  let bIdx = 0;
  for (const s of SCHEDULES) {
    const parts = s.split === 2 ? distribute(s.tonnes, 2, rng) : [s.tonnes];
    parts.forEach((t, i) => {
      budget.push({
        id: `bgt-${String(++bIdx).padStart(3, '0')}`,
        projectId: project.id,
        scheduleRef: s.ref,
        location: s.location,
        element: s.element,
        description: s.split === 2 ? `${s.description} (${i === 0 ? 'A' : 'B'})` : s.description,
        budgetTonnes: t,
        budgetRate: s.rate,
        budgetValue: Math.round(t * s.rate * 100) / 100,
        supplier: s.supplier,
        package: s.pkg,
        phase: s.phase,
        area: s.area,
        notes: i === 0 ? '' : 'Split allowance — same schedule',
        source: 'imported',
        importId: 'imp-seed-budget',
        createdAt: ts,
        updatedAt: ts,
      });
    });
  }

  // --- Deliveries (112, deliberately imperfect) ------------------------------
  const deliveries: Delivery[] = [];
  const costs: CostRecord[] = [];
  const schedTotals = SCHEDULES.map((s) => ({ s, target: Math.round(s.tonnes * (0.58 + rng() * 0.22) * 100) / 100 }));
  const perSched: number[] = schedTotals.map(() => 0);
  let dIdx = 0;

  // Plan: 112 deliveries. costed picks come later.
  const plan: { schedIdx: number; tonnes: number }[] = [];
  schedTotals.forEach(({ target }, si) => {
    const n = si < 7 ? 12 : 9; // 7×12 + 4×9 = 120 → trim below to 112
    const parts = distribute(target, n, rng);
    for (const t of parts) plan.push({ schedIdx: si, tonnes: t });
  });
  plan.length = 112;
  plan.sort((a, b) => a.schedIdx - b.schedIdx);

  // Imperfection slots
  const duplicateSlot = new Set([10, 33, 58]); // each gets a partner below
  const missingTicketSlots = new Set([7, 91]);
  const missingSchedSlots = new Set([21, 66]);
  const missingLocSlots = new Set([44, 99]);
  const mismatchSlots = new Set([3, 14, 27, 48, 72, 88]); // costed tonnage differs materially
  const formatVariantSlots = new Set([5, 30, 55, 80]); // ticket formatted differently in cost system

  let ticketSeq = 1000;
  for (let i = 0; i < plan.length; i++) {
    const { schedIdx, tonnes } = plan[i];
    const s = SCHEDULES[schedIdx];
    const date = rndDate(rng, '2026-04-01', '2026-09-20');
    const supplier = i % 5 === 0 ? 'RNdliffe' : s.supplier;
    let ticket = `${supplier === 'RNdliffe' ? 'RNL' : 'CARE'}-${String(++ticketSeq).padStart(6, '0')}`;
    if (missingTicketSlots.has(i)) ticket = '';
    const id = `dlv-${String(++dIdx).padStart(3, '0')}`;
    const delivery: Delivery = {
      id,
      projectId: project.id,
      deliveryDate: date,
      ticketNo: ticket,
      ticketNorm: normaliseTicket(ticket),
      scheduleRef: missingSchedSlots.has(i) ? '' : s.ref,
      location: missingLocSlots.has(i) ? '' : s.location,
      element: s.element,
      area: s.area,
      package: s.pkg,
      phase: s.phase,
      tonnes,
      description: s.description,
      supplier,
      source: 'imported',
      importId: 'imp-seed-delivery',
      importedTonnes: tonnes,
      importedTicketNo: ticket,
      raw: {},
      createdAt: ts,
      updatedAt: ts,
    };
    deliveries.push(delivery);
    perSched[schedIdx] += tonnes;
    // Partner record for duplicate tickets
    if (duplicateSlot.has(i)) {
      const dup = { ...delivery, id: `dlv-${String(++dIdx).padStart(3, '0')}`, tonnes: Math.round(tonnes * 0.6 * 100) / 100, importedTonnes: Math.round(tonnes * 0.6 * 100) / 100 };
      deliveries.push(dup);
      perSched[schedIdx] += dup.tonnes;
    }
  }

  // --- Costs (91 records) ----------------------------------------------------
  // Cost 84 deliveries (incl. mismatch + format-variant slots), add 4 duplicate
  // cost records and 3 orphan costs with no delivery at all.
  let cIdx = 0;
  // Cost roughly two thirds of deliveries, spread across every schedule and
  // the full date range, leaving a realistic tail of uncosted deliveries.
  const costedDeliveries = deliveries.filter((d, i) => d.ticketNo !== '' && i % 3 !== 2);
  costedDeliveries.forEach((d, i) => {
    const sched = SCHEDULES.find((s) => s.ref === d.scheduleRef) ?? SCHEDULES[0];
    let ticket = d.ticketNo;
    if (formatVariantSlots.has(i)) {
      // Same ticket, different formatting — must still match after normalisation
      ticket = i % 2 === 0 ? ` ${d.ticketNo.toLowerCase().replace('-', ' ')} ` : d.ticketNo.replace('-', '-000').replace('--', '-');
    }
    const mismatch = mismatchSlots.has(i);
    const costedTonnes = mismatch
      ? Math.round(d.tonnes * (i % 2 === 0 ? 1.18 : 0.74) * 100) / 100
      : d.tonnes;
    let rate = sched.rate * (0.92 + rng() * 0.2);
    if (i === 12) rate = sched.rate * 1.62; // unusually high rate
    if (i === 47) rate = sched.rate * 1.55; // unusually high rate
    if (i === 63) rate = sched.rate * 0.58; // unusually low rate
    const cost = Math.round(costedTonnes * rate * 100) / 100;
    costs.push({
      id: `cst-${String(++cIdx).padStart(3, '0')}`,
      projectId: project.id,
      costDate: addDays(d.deliveryDate, 15 + Math.floor(rng() * 40)),
      ticketNo: ticket,
      ticketNorm: normaliseTicket(ticket),
      costedTonnes,
      cost,
      supplier: d.supplier,
      costRef: `INV-${2600 + cIdx}`,
      source: 'imported',
      importId: 'imp-seed-cost',
      importedTonnes: costedTonnes,
      importedCost: cost,
      importedTicketNo: ticket,
      raw: {},
      createdAt: ts,
      updatedAt: ts,
    });
    if (duplicateSlot.has(deliveries.indexOf(d)) || i === 20 || i === 45 || i === 70) {
      // Duplicate cost record — same ticket costed twice
      costs.push({
        ...({} as CostRecord),
        id: `cst-${String(++cIdx).padStart(3, '0')}`,
        projectId: project.id,
        costDate: addDays(d.deliveryDate, 55 + Math.floor(rng() * 20)),
        ticketNo: d.ticketNo,
        ticketNorm: d.ticketNorm,
        costedTonnes: d.tonnes,
        cost: Math.round(d.tonnes * sched.rate * 0.05 * 100) / 100 + Math.round(d.tonnes * sched.rate * 100) / 100,
        supplier: d.supplier,
        costRef: `INV-${2700 + cIdx}`,
        source: 'imported',
        importId: 'imp-seed-cost',
        importedTonnes: d.tonnes,
        importedCost: 0,
        importedTicketNo: d.ticketNo,
        raw: {},
        createdAt: ts,
        updatedAt: ts,
      });
    }
  });
  // Orphan costs — no matching delivery exists
  for (let i = 0; i < 3; i++) {
    const t = Math.round((6 + rng() * 9) * 100) / 100;
    costs.push({
      id: `cst-${String(++cIdx).padStart(3, '0')}`,
      projectId: project.id,
      costDate: rndDate(rng, '2026-06-01', '2026-09-30'),
      ticketNo: `RNL-9${String(900 + i).padStart(5, '0')}`,
      ticketNorm: normaliseTicket(`RNL-9${String(900 + i).padStart(5, '0')}`),
      costedTonnes: t,
      cost: Math.round(t * 1035 * 100) / 100,
      supplier: 'RNdliffe',
      costRef: `INV-29${10 + i}`,
      source: 'imported',
      importId: 'imp-seed-cost',
      importedTonnes: t,
      importedCost: 0,
      importedTicketNo: `RNL-9${String(900 + i).padStart(5, '0')}`,
      raw: {},
      createdAt: ts,
      updatedAt: ts,
    });
  }

  // --- Second project (isolation proof) --------------------------------------
  const budget2: BudgetLine[] = [
    {
      id: 'bgt-r1', projectId: project2.id, scheduleRef: 'R101', location: 'Podium',
      element: 'Slabs', description: 'Podium slab reinforcement', budgetTonnes: 140,
      budgetRate: 1035, budgetValue: 140 * 1035, supplier: 'Careys', package: 'Podium',
      phase: 'Phase 2', area: 'Zone R', notes: '', source: 'manual', createdAt: ts, updatedAt: ts,
    },
    {
      id: 'bgt-r2', projectId: project2.id, scheduleRef: 'R201', location: 'Tower Core',
      element: 'Core walls', description: 'Tower core walls', budgetTonnes: 210,
      budgetRate: 1065, budgetValue: 210 * 1065, supplier: 'Careys', package: 'Core',
      phase: 'Phase 2', area: 'Zone R', notes: '', source: 'manual', createdAt: ts, updatedAt: ts,
    },
  ];
  const deliveries2: Delivery[] = [
    {
      id: 'dlv-r1', projectId: project2.id, deliveryDate: '2026-07-14', ticketNo: 'RIV-000031',
      ticketNorm: normaliseTicket('RIV-000031'), scheduleRef: 'R101', location: 'Podium',
      element: 'Slabs', area: 'Zone R', package: 'Podium', phase: 'Phase 2', tonnes: 22.4,
      description: 'Podium slab reinforcement', supplier: 'Careys', source: 'manual',
      importedTonnes: 22.4, raw: {}, createdAt: ts, updatedAt: ts,
    },
    {
      id: 'dlv-r2', projectId: project2.id, deliveryDate: '2026-08-02', ticketNo: 'RIV-000047',
      ticketNorm: normaliseTicket('RIV-000047'), scheduleRef: 'R201', location: 'Tower Core',
      element: 'Core walls', area: 'Zone R', package: 'Core', phase: 'Phase 2', tonnes: 18.9,
      description: 'Tower core walls', supplier: 'Careys', source: 'manual',
      importedTonnes: 18.9, raw: {}, createdAt: ts, updatedAt: ts,
    },
  ];
  const costs2: CostRecord[] = [
    {
      id: 'cst-r1', projectId: project2.id, costDate: '2026-08-05', ticketNo: 'riv 31',
      ticketNorm: normaliseTicket('riv 31'), costedTonnes: 22.4, cost: 22.4 * 1040,
      supplier: 'Careys', costRef: 'RIV-INV-08', source: 'manual', importedTonnes: 22.4,
      importedCost: 22.4 * 1040, raw: {}, createdAt: ts, updatedAt: ts,
    },
  ];

  const imports: ImportRecord[] = [
    {
      id: 'imp-seed-budget', projectId: project.id, type: 'budget',
      fileName: 'AS24_Rebar_Budget_RevC.xlsx', importedAt: '2026-03-28T09:12:00Z', user: 'A. Whitfield (QS)',
      columnMap: { Schedule: 'scheduleRef', 'Budget t': 'budgetTonnes', 'Budget £/t': 'budgetRate' },
      totalRows: budget.length, imported: budget.length, rejected: 0, duplicates: 0, exceptions: 0,
      notes: 'Initial budget allowance Rev C',
    },
    {
      id: 'imp-seed-delivery', projectId: project.id, type: 'delivery',
      fileName: 'CallOff_Register_Apr-Sep26.csv', importedAt: '2026-09-21T16:40:00Z', user: 'A. Whitfield (QS)',
      columnMap: { Date: 'deliveryDate', Docket: 'ticketNo', Sched: 'scheduleRef', Tonnage: 'tonnes' },
      totalRows: deliveries.length, imported: deliveries.length, rejected: 0, duplicates: 3,
      exceptions: 8, notes: 'Site delivery register Apr–Sep 2026',
    },
    {
      id: 'imp-seed-cost', projectId: project.id, type: 'cost',
      fileName: 'BMS_Cost_Extract_2609.csv', importedAt: '2026-09-22T08:05:00Z', user: 'J. Okafor (Commercial Mgr)',
      columnMap: { 'Inv Date': 'costDate', 'Ticket No': 'ticketNo', 'Net Value': 'cost', 'Inv Tonnage': 'costedTonnes' },
      totalRows: costs.length, imported: costs.length, rejected: 0, duplicates: 4,
      exceptions: 3, notes: 'External cost system extract to 26 Sep',
    },
    {
      id: 'imp-seed-budget-2', projectId: project2.id, type: 'budget',
      fileName: 'RT_Phase2_Budget.xlsx', importedAt: '2026-06-10T11:00:00Z', user: 'A. Whitfield (QS)',
      columnMap: { Schedule: 'scheduleRef', Tonnes: 'budgetTonnes', Rate: 'budgetRate' },
      totalRows: 2, imported: 2, rejected: 0, duplicates: 0, exceptions: 0, notes: 'Phase 2 allowance',
    },
  ];

  return {
    projects: [project, project2],
    budget: [...budget, ...budget2],
    deliveries: [...deliveries, ...deliveries2],
    costs: [...costs, ...costs2],
    imports,
    audit: [],
    links: [],
    overrides: [],
    forecasts: {},
    currentProjectId: project.id,
    user: 'A. Whitfield (QS)',
    ...existing,
  };
}
