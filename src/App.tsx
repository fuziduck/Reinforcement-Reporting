/** App shell: navigation, project switcher, routing. All data is project-scoped. */
import { useEffect, useState } from 'react';
import { replaceDatabase, setCurrentProject, addProject, useDb } from './lib/store';
import { buildSeedDatabase } from './lib/seed';
import { useProjectData } from './lib/selectors';
import { DashboardPage } from './pages/Dashboard';
import { BudgetPage } from './pages/Budget';
import { DeliveriesPage } from './pages/Deliveries';
import { CostsPage } from './pages/Costs';
import { ReconciliationPage, ExceptionsPage } from './pages/Reconciliation';
import { BudgetVsActualPage, ScheduleDetailPage } from './pages/BudgetVsActual';
import { ForecastPage } from './pages/Forecast';
import { ReportsPage } from './pages/Reports';
import { ImportsPage, SettingsPage } from './pages/Management';
import { Field, Card } from './components/ui';

type Route =
  | 'dashboard' | 'budget' | 'deliveries' | 'costs' | 'reconciliation'
  | 'bva' | 'forecast' | 'exceptions' | 'reports' | 'imports' | 'settings';

const NAV: { route: Route; label: string; ico: string }[] = [
  { route: 'dashboard', label: 'Dashboard', ico: '▦' },
  { route: 'budget', label: 'Budget', ico: '▤' },
  { route: 'deliveries', label: 'Deliveries', ico: '⛻' },
  { route: 'costs', label: 'Costs', ico: '£' },
  { route: 'reconciliation', label: 'Reconciliation', ico: '⇄' },
  { route: 'bva', label: 'Budget vs Actual', ico: '◫' },
  { route: 'forecast', label: 'Forecast', ico: '↗' },
  { route: 'exceptions', label: 'Exceptions', ico: '⚠' },
  { route: 'reports', label: 'Reports', ico: '▦' },
  { route: 'imports', label: 'Imports', ico: '⬆' },
  { route: 'settings', label: 'Project Settings', ico: '⚙' },
];

const TITLES: Record<Route, string> = {
  dashboard: 'Commercial Dashboard',
  budget: 'Reinforcement Budget',
  deliveries: 'Delivery Register',
  costs: 'Cost Register',
  reconciliation: 'Delivery / Cost Reconciliation',
  bva: 'Reinforcement Budget vs Actual',
  forecast: 'Forecast',
  exceptions: 'Exceptions',
  reports: 'Reinforcement Cost Report',
  imports: 'Import History',
  settings: 'Project Settings',
};

export default function App() {
  const db = useDb();
  const data = useProjectData();
  const [route, setRoute] = useState<Route>('bva');
  const [drillSchedule, setDrillSchedule] = useState<string | null>(null);

  // First run: load the deliberately-imperfect sample project (§29)
  useEffect(() => {
    if (db.projects.length === 0) {
      replaceDatabase(buildSeedDatabase());
    } else if (!db.currentProjectId && db.projects[0]) {
      setCurrentProject(db.projects[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exceptionCount = data.exceptions.reduce((a, e) => a + e.count, 0);

  const go = (r: Route) => {
    setRoute(r);
    setDrillSchedule(null);
  };

  if (db.projects.length === 0) {
    return (
      <div className="content" style={{ maxWidth: 720, margin: '80px auto' }}>
        <Card title="Rebar Commercial Control">
          <div className="card-body">
            <p>
              Reinforcement quantity, budget, cost and commercial control — budget → delivered →
              costed → accrued → remaining → forecast final.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn primary" onClick={() => replaceDatabase(buildSeedDatabase())}>
                Load sample project data
              </button>
              <button
                className="btn"
                onClick={() =>
                  addProject({
                    name: 'New Project', number: 'P-001', client: '', mainContractor: '',
                    startDate: '', completionDate: '', status: 'Planning',
                  })
                }
              >
                Create empty project
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">
            <span className="brand-mark">RC</span> Rebar Commercial
          </div>
          <div className="brand-sub">Quantity & Cost Control</div>
        </div>
        <div className="project-select">
          <label>Project</label>
          <select
            value={db.currentProjectId ?? ''}
            onChange={(e) => {
              setCurrentProject(e.target.value);
              go('bva');
            }}
          >
            {db.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <nav className="nav">
          <div className="nav-section">Commercial control</div>
          {NAV.slice(0, 8).map((n) => (
            <button
              key={n.route}
              className={`nav-item ${route === n.route ? 'active' : ''}`}
              onClick={() => go(n.route)}
            >
              <span className="ico">{n.ico}</span>
              {n.label}
              {n.route === 'exceptions' && exceptionCount > 0 && (
                <span className="nav-badge">{exceptionCount}</span>
              )}
            </button>
          ))}
          <div className="nav-section">Administration</div>
          {NAV.slice(8).map((n) => (
            <button
              key={n.route}
              className={`nav-item ${route === n.route ? 'active' : ''}`}
              onClick={() => go(n.route)}
            >
              <span className="ico">{n.ico}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {db.user}
          <br />
          {data.project ? `${data.project.status} · ${data.project.client}` : ''}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{TITLES[route]}</h1>
            <div className="crumb">
              {data.project
                ? `${data.project.name} · ${data.project.number} · ${data.project.mainContractor}`
                : 'No project selected'}
              {drillSchedule ? `  ›  ${drillSchedule}` : ''}
            </div>
          </div>
          <div className="actions">
            {route !== 'bva' && (
              <button className="btn" onClick={() => go('bva')}>
                ◫ Budget vs Actual
              </button>
            )}
            <button className="btn" onClick={() => go('reports')}>
              ⎙ Report / PDF
            </button>
          </div>
        </div>
        <div className="content">
          {route === 'dashboard' && <DashboardPage />}
          {route === 'budget' && <BudgetPage />}
          {route === 'deliveries' && <DeliveriesPage />}
          {route === 'costs' && <CostsPage />}
          {route === 'reconciliation' && (
            <ReconciliationPage
              onOpenSchedule={(s) => {
                setDrillSchedule(s);
                setRoute('bva');
              }}
            />
          )}
          {route === 'bva' &&
            (drillSchedule ? (
              <ScheduleDetailPage scheduleRef={drillSchedule} onBack={() => setDrillSchedule(null)} />
            ) : (
              <BudgetVsActualPage onOpenSchedule={setDrillSchedule} />
            ))}
          {route === 'forecast' && <ForecastPage />}
          {route === 'exceptions' && <ExceptionsPage />}
          {route === 'reports' && <ReportsPage />}
          {route === 'imports' && <ImportsPage />}
          {route === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}
