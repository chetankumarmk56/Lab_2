/**
 * The guide route — one continuous scroll through all five labs, staged as a
 * training film.
 *
 * Self-contained by design: everything it needs lives in this folder, including
 * its stylesheet (imported below, not merged into styles.css). Deleting
 * src/guide/ and the three lines that reference it in App.tsx removes the
 * feature completely.
 *
 * Motion: src/guide/film/ holds the "film engine" — one rAF loop that eases
 * scroll and drives the HUD/timecode, the hero's particle canvas, the scrubbed
 * spine and the marquee. Chapters keep their CSS-driven reveals; React still
 * owns only which beat of a chapter is active. Press ▶ (or Space) and the
 * page plays itself at reading pace; any scroll takes the wheel back.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Lab1Chapter from './chapters/Lab1Chapter'
import Lab2Chapter from './chapters/Lab2Chapter'
import Lab3Chapter from './chapters/Lab3Chapter'
import Lab4Chapter from './chapters/Lab4Chapter'
import Lab5Chapter from './chapters/Lab5Chapter'
import FilmChrome, { type FilmZone } from './film/FilmChrome'
import HeroCanvas from './film/HeroCanvas'
import SpineScrub from './film/SpineScrub'
import Marquee from './film/Marquee'
import { useFilmEngine, useMagnet } from './film/useFilm'
import { ArrowRight, Play } from '../components/icons'
import './guide.css'

const CHAPTERS = [
  { id: 'lab1', n: 1, label: 'Shift Report' },
  { id: 'lab2', n: 2, label: 'Permit Query' },
  { id: 'lab3', n: 3, label: 'Triage' },
  { id: 'lab4', n: 4, label: 'Job Aid' },
  { id: 'lab5', n: 5, label: 'MCP Builder' },
]

/** HUD zones: where the "playhead" is, in film terms. Labs are seek ticks. */
const ZONES: FilmZone[] = [
  { id: 'guide-top', label: '00 · COLD OPEN' },
  ...CHAPTERS.map((c) => ({ id: c.id, label: `${String(c.n).padStart(2, '0')} · ${c.label.toUpperCase()}`, tick: true })),
  { id: 'guide-outro', label: 'FIN · GO BREAK ONE', tick: true },
]

/** The recurring question the five labs each answer differently. */
const SPINE = [
  { n: 1, answer: 'Three read-only file tools, one throwaway folder.' },
  { n: 2, answer: 'One SQL tool, behind three independent locks.' },
  { n: 3, answer: 'Two tools — and the write one is denied at runtime.' },
  { n: 4, answer: 'Nothing. No tools at all.' },
  { n: 5, answer: 'Tools generated at runtime for a database you bring.' },
]

/** Looping hero diagram: prompt → tool → result → answer. */
function AgentLoop() {
  const nodes = ['You ask', 'Agent decides', 'Tool runs', 'Answer'] as const
  return (
    <div className="g-loop" aria-hidden="true">
      {nodes.map((n, i) => (
        <div key={n} className="g-loop-node" style={{ animationDelay: `${i * 0.62}s` }}>
          <span>{n}</span>
        </div>
      ))}
      <span className="g-loop-track" />
    </div>
  )
}

export default function Guide() {
  const engine = useFilmEngine()
  const rootRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const magPlay = useMagnet<HTMLButtonElement>(engine)
  const magScrub = useMagnet<HTMLButtonElement>(engine, 0.14)

  // Arm the hero's cascade one frame after mount so the transition can run.
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setLoaded(true)))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Deep links (/guide#lab3) need a manual scroll: the sections mount with the
  // route, after the browser has already tried and failed to find the hash.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const el = document.getElementById(id)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [])

  const jumpTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) engine.tweenTo(Math.max(0, el.offsetTop - 8), 1450)
  }

  return (
    <div className={`g-root gf-root ${loaded ? 'in' : ''}`} ref={rootRef}>
      <FilmChrome engine={engine} zones={ZONES} rootRef={rootRef} />

      <header className="g-hero gf-hero" id="guide-top">
        <HeroCanvas engine={engine} />
        <div className="gf-hero-inner">
          <span className="eyebrow gf-eyebrow">Training film · Field guide</span>
          <h1 className="gf-title">
            <span className="gf-l"><span className="gf-w">Five agents, and</span></span>
            <span className="gf-l"><span className="gf-w">the <em>one question</em></span></span>
            <span className="gf-l"><span className="gf-w">behind all of them</span></span>
          </h1>
          <p className="g-hero-sub gf-sub">
            Every lab in this console does something useful. What makes them worth studying
            together is that each one answers the same question a different way:{' '}
            <b>what is this agent allowed to touch?</b>
          </p>
          <AgentLoop />
          <div className="gf-cta">
            {!engine.reduced && (
              <button className="gf-btn pri" ref={magPlay} onClick={() => engine.play()}>
                <Play width={14} height={14} /> Press play
              </button>
            )}
            <button className="gf-btn gho" ref={magScrub} onClick={() => jumpTo('guide-spine')}>
              Scroll to scrub
            </button>
          </div>
          <p className="g-hero-note gf-note">
            Scroll — each chapter walks through one lab: the job it does, how it works, and where
            its limits are wired in. Nothing here calls the API, so it works whether or not the
            backend is running. {!engine.reduced && <>Space plays and pauses; ← → step between scenes.</>}
          </p>
        </div>
      </header>

      <div id="guide-spine">
        <SpineScrub engine={engine} items={SPINE} onJump={jumpTo} />
      </div>

      <Lab1Chapter />
      <Lab2Chapter />
      <Lab3Chapter />
      <Lab4Chapter />
      <Lab5Chapter />

      <Marquee engine={engine} items={['Five agents', 'One question', 'What can it touch', 'Now go break one']} />

      <footer className="g-outro" id="guide-outro">
        <h2>Now go break one</h2>
        <p>
          Reading about a boundary is not the same as watching it hold. Open a lab and try to make
          it do something it shouldn't — ask Lab 2 to approve a permit, or tell Lab 3 to assign a
          crew without you.
        </p>
        <div className="g-outro-links">
          {CHAPTERS.map((c) => (
            <Link key={c.id} to={`/lab${c.n}`} className="g-outro-link">
              Lab {String(c.n).padStart(2, '0')} · {c.label}
              <ArrowRight width={14} height={14} />
            </Link>
          ))}
        </div>
      </footer>
    </div>
  )
}
