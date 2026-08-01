/**
 * The spine, staged as a scrubbed scene.
 *
 * The guide's whole argument is one recurring question — "what can it touch?"
 * — answered five different ways. Here the question pins to the viewport and
 * scroll becomes the scrubber: each answer slides through focus in turn, with
 * its lab number ghosted behind it. Scrolling up rewinds. Clicking an answer
 * jumps to that lab's chapter.
 *
 * All motion is driven from the engine's eased scroll value, so the scene
 * shares the page's soft, slightly-slow feel instead of tracking the wheel
 * raw. Small screens, coarse pointers and reduced motion get the plain list
 * (the original spine layout) — the pin trick earns nothing there.
 */
import { useEffect, useRef, useState } from 'react'
import type { FilmEngine } from './useFilm'
import { useInView } from '../useInView'

export interface SpineItem {
  n: number
  answer: string
}

interface Props {
  engine: FilmEngine
  items: SpineItem[]
  onJump: (labId: string) => void
}

/** Height of each answer's scrub window, in vh. */
const WINDOW_VH = 58

function StaticSpine({ items, onJump }: Omit<Props, 'engine'>) {
  const { ref, inView } = useInView<HTMLElement>()
  return (
    <section className={`g-spine ${inView ? 'in' : ''}`} ref={ref} aria-label="How each lab bounds its agent">
      <h2 className="g-spine-q">“What can it touch?”</h2>
      <ol className="g-spine-list">
        {items.map((s, i) => (
          <li key={s.n} style={{ ['--i' as string]: i }}>
            <a
              href={`#lab${s.n}`}
              onClick={(e) => { e.preventDefault(); onJump(`lab${s.n}`) }}
            >
              <span className="g-spine-n">{String(s.n).padStart(2, '0')}</span>
              <span className="g-spine-a">{s.answer}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function SpineScrub({ engine, items, onJump }: Props) {
  const [filmMode, setFilmMode] = useState(
    () => engine.finePointer && !engine.reduced && window.matchMedia('(min-width: 1100px)').matches,
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const ansRefs = useRef<(HTMLButtonElement | null)[]>([])
  const numRefs = useRef<(HTMLSpanElement | null)[]>([])
  const counterRef = useRef<HTMLSpanElement>(null)
  const railRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1100px)')
    const onChange = () =>
      setFilmMode(engine.finePointer && !engine.reduced && mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [engine])

  useEffect(() => {
    if (!filmMode) return
    const wrap = wrapRef.current
    if (!wrap) return
    const n = items.length
    let lastCount = ''

    const off = engine.onFrame((f) => {
      const vh = window.innerHeight
      const total = wrap.offsetHeight - vh
      if (total <= 0) return
      const local = Math.min(1, Math.max(0, (f.smooth - wrap.offsetTop) / total))

      // Ease the whole stage in and out at the pin's edges.
      if (stickyRef.current) {
        const edge = Math.min(local / 0.045, (1 - local) / 0.045, 1)
        stickyRef.current.style.opacity = String(Math.max(0, edge))
      }

      for (let i = 0; i < n; i++) {
        // Distance of answer i from the focus point, in "answers".
        const d = local * n - (i + 0.5)
        const v = Math.max(0, 1 - Math.abs(d) / 0.66)
        const el = ansRefs.current[i]
        if (el) {
          el.style.opacity = String(v * v * (3 - 2 * v))
          el.style.transform = `translate(0, calc(-50% + ${d * -130}px)) scale(${0.955 + v * 0.045})`
          el.style.pointerEvents = v > 0.5 ? 'auto' : 'none'
          el.tabIndex = v > 0.5 ? 0 : -1
        }
        const num = numRefs.current[i]
        if (num) num.style.opacity = String(v * 0.85)
      }

      if (railRef.current) railRef.current.style.transform = `scaleX(${local})`
      if (counterRef.current) {
        const active = Math.min(n, Math.max(1, Math.ceil(local * n + 0.0001)))
        const label = `${String(active).padStart(2, '0')} / ${String(n).padStart(2, '0')}`
        if (label !== lastCount) {
          lastCount = label
          counterRef.current.textContent = label
        }
      }
    })
    return off
  }, [engine, filmMode, items.length])

  if (!filmMode) return <StaticSpine items={items} onJump={onJump} />

  return (
    <div
      className="gf-spine"
      ref={wrapRef}
      style={{ height: `calc(100vh + ${items.length * WINDOW_VH}vh)` }}
      aria-label="How each lab bounds its agent"
    >
      <div className="gf-spine-sticky" ref={stickyRef}>
        <div className="gf-spine-left">
          <span className="eyebrow">The recurring question</span>
          <h2 className="gf-spine-q">
            What can<br />it <em>touch?</em>
          </h2>
          <p className="gf-spine-hint">Scroll to scrub through five answers — click one to jump to its lab.</p>
          <div className="gf-spine-rail">
            <span className="gf-spine-fill" ref={railRef} />
          </div>
          <span className="gf-spine-count" ref={counterRef}>01 / {String(items.length).padStart(2, '0')}</span>
        </div>

        <div className="gf-spine-stage">
          {items.map((s, i) => (
            <span
              key={`n${s.n}`}
              className="gf-spine-ghost"
              ref={(el) => { numRefs.current[i] = el }}
              aria-hidden="true"
            >
              {String(s.n).padStart(2, '0')}
            </span>
          ))}
          {items.map((s, i) => (
            <button
              key={s.n}
              className="gf-spine-ans"
              ref={(el) => { ansRefs.current[i] = el }}
              onClick={() => onJump(`lab${s.n}`)}
            >
              <span className="gf-spine-lab">LAB {String(s.n).padStart(2, '0')}</span>
              <span className="gf-spine-text">{s.answer}</span>
              <span className="gf-spine-go">Jump to chapter →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
