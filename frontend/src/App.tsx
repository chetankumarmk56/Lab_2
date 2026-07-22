import { NavLink, Route, Routes } from 'react-router-dom'
import Lab1ShiftReport from './labs/Lab1ShiftReport'
import Lab2PermitQuery from './labs/Lab2PermitQuery'
import Lab3Triage from './labs/Lab3Triage'
import Lab4JobAid from './labs/Lab4JobAid'
import { useTheme } from './lib/useTheme'
import { ArrowRight, Moon, Sun } from './components/icons'

interface LabMeta {
  path: string
  num: number
  title: string
  sector: string
  ready: boolean
  blurb: string
}

const LABS: LabMeta[] = [
  {
    path: '/lab1', num: 1, title: 'Shift Report', sector: 'Manufacturing', ready: true,
    blurb: 'Turn end-of-shift machine logs into a one-page report with an exceptions section.',
  },
  {
    path: '/lab2', num: 2, title: 'Permit Status Query', sector: 'Public Sector', ready: true,
    blurb: 'Ask permit questions in plain English; the agent runs read-only SQL and answers.',
  },
  {
    path: '/lab3', num: 3, title: 'Work Order Triage', sector: 'Manufacturing', ready: true,
    blurb: 'Classify maintenance requests by urgency and route them — with human approval.',
  },
  {
    path: '/lab4', num: 4, title: 'Job Aid Generator', sector: 'Public Sector', ready: true,
    blurb: 'Generate a formatted job aid from a tested workflow and an agency template.',
  },
]

function Home() {
  const ready = LABS.filter((l) => l.ready).length
  return (
    <div className="home">
      <header className="home-hero">
        <span className="eyebrow">Claude Code · MCP · Agent SDK</span>
        <h1>Agentic AI Onboarding Labs</h1>
        <p className="subtitle">
          Five scenario-driven agents for manufacturing and public-sector teams — each one a
          working build with a real data source and a purpose-built console.
        </p>
        <div className="hero-meta">
          <div className="hero-stat"><div className="n">{ready} / {LABS.length}</div><div className="l">Labs Ready</div></div>
          <div className="hero-stat"><div className="n">MCP</div><div className="l">Live Data Tools</div></div>
          <div className="hero-stat"><div className="n">Read-only</div><div className="l">Safe by Default</div></div>
        </div>
      </header>

      <div className="cards">
        {LABS.map((l) => (
          <NavLink
            key={l.path}
            to={l.ready ? l.path : '#'}
            className={`card ${l.ready ? '' : 'disabled'}`}
          >
            <div className="card-top">
              <span className="card-num">LAB {String(l.num).padStart(2, '0')}</span>
              <span className="card-sector">{l.sector}</span>
            </div>
            <div className="card-title">{l.title}</div>
            <p className="card-blurb">{l.blurb}</p>
            <span className="card-status">
              {l.ready ? <>Open console <ArrowRight className="card-arrow" width={15} height={15} /></> : 'Coming soon'}
            </span>
          </NavLink>
        ))}
      </div>
    </div>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>
      {dark ? <Moon width={16} height={16} /> : <Sun width={16} height={16} />}
      <span className="tt-label">{theme} mode</span>
    </button>
  )
}

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">◆</span>
          <span>
            <span className="brand-name">Agentic Labs</span>
            <span className="brand-sub">Operations Console</span>
          </span>
        </NavLink>

        <div className="side-label">Labs</div>
        <nav>
          <NavLink to="/" end className="nav-item">
            <span className="nav-num">⌂</span>
            <span className="nav-label">Home</span>
          </NavLink>
          {LABS.map((l) => (
            <NavLink
              key={l.path}
              to={l.ready ? l.path : '#'}
              className={({ isActive }) =>
                `nav-item ${isActive && l.ready ? 'active' : ''} ${l.ready ? '' : 'soon'}`
              }
              onClick={(e) => { if (!l.ready) e.preventDefault() }}
            >
              <span className="nav-num">{l.num}</span>
              <span className="nav-label">{l.title}</span>
              {!l.ready && <span className="nav-soon-tag">soon</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <ThemeToggle />
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lab1" element={<Lab1ShiftReport />} />
          <Route path="/lab2" element={<Lab2PermitQuery />} />
          <Route path="/lab3" element={<Lab3Triage />} />
          <Route path="/lab4" element={<Lab4JobAid />} />
        </Routes>
      </main>
    </div>
  )
}
