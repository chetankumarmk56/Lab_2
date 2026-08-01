/**
 * The film chrome: everything that makes the guide read as footage.
 *
 *   - a HUD strip with a REC dot, the current scene label, a running timecode
 *     (scroll position mapped onto the film's "runtime"), and a play control
 *   - a seekbar whose ticks are the five labs — click to jump, like chapters
 *     on a DVD; it replaces the old pill nav outright
 *   - letterbox bars that close in while autoplay is rolling
 *   - film grain, generated once onto a small tile and looped at ~9fps
 *   - a custom cursor (dot + trailing ring) that only exists inside the guide
 *
 * Per-frame values (timecode, seek fill, cursor) are written straight to the
 * DOM through refs — React re-renders only when discrete state flips (playing,
 * current scene), which is a few times a minute, not sixty times a second.
 *
 * Reduced motion: no autoplay, no grain, no letterbox, no custom cursor. The
 * HUD and seekbar stay — they are navigation, not decoration.
 */
import { useEffect, useRef, useState } from 'react'
import type { FilmEngine } from './useFilm'
import { PLAY_PXPS } from './useFilm'

export interface FilmZone {
  /** DOM id of the section this zone labels. */
  id: string
  /** HUD label, e.g. "01 · SHIFT REPORT". */
  label: string
  /** Rendered as a clickable tick on the seekbar when true. */
  tick?: boolean
}

interface Props {
  engine: FilmEngine
  zones: FilmZone[]
  /** The guide's root element — the region the custom cursor lives in. */
  rootRef: React.RefObject<HTMLElement>
}

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0')

/** A 140px noise tile as a data URI — the entire cost of "film grain". */
function grainTile(): string {
  const c = document.createElement('canvas')
  c.width = c.height = 140
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(140, 140)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL()
}

export default function FilmChrome({ engine, zones, rootRef }: Props) {
  const [playing, setPlaying] = useState(false)
  const [zoneLabel, setZoneLabel] = useState(zones[0]?.label ?? '')
  const [ticks, setTicks] = useState<Array<FilmZone & { left: number }>>([])
  const [overRoot, setOverRoot] = useState(false)

  const fillRef = useRef<HTMLSpanElement>(null)
  const tcRef = useRef<HTMLSpanElement>(null)
  const grainRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const zoneTops = useRef<number[]>([])
  const zoneIdx = useRef(0)

  const cursorOn = engine.finePointer && !engine.reduced

  /* Measure zone offsets and tick positions; again after fonts/layout settle. */
  useEffect(() => {
    const measure = () => {
      engine.measure()
      const docH = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      zoneTops.current = zones.map((z) => document.getElementById(z.id)?.offsetTop ?? 0)
      setTicks(
        zones
          .filter((z) => z.tick)
          .map((z) => ({
            ...z,
            left: Math.min(99, ((document.getElementById(z.id)?.offsetTop ?? 0) / docH) * 100),
          })),
      )
    }
    measure()
    const late = window.setTimeout(measure, 600)
    if ('fonts' in document) document.fonts.ready.then(measure).catch(() => {})
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(late)
      window.removeEventListener('resize', measure)
    }
  }, [engine, zones])

  /* Per-frame DOM writes: seek fill, timecode, current zone, cursor. */
  useEffect(() => {
    let lastTc = ''
    let ringX = -100
    let ringY = -100
    const off = engine.onFrame((f) => {
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${f.progress})`

      if (tcRef.current) {
        const runtime = f.docH / PLAY_PXPS
        const t = f.progress * runtime
        const tc = `TC ${pad(t / 60)}:${pad(t % 60)}:${pad((t % 1) * 24)}`
        if (tc !== lastTc) {
          lastTc = tc
          tcRef.current.textContent = tc
        }
      }

      const line = f.smooth + window.innerHeight * 0.45
      let idx = 0
      for (let i = 0; i < zoneTops.current.length; i++) {
        if (zoneTops.current[i] <= line) idx = i
      }
      if (idx !== zoneIdx.current) {
        zoneIdx.current = idx
        setZoneLabel(zones[idx]?.label ?? '')
      }

      if (dotRef.current && ringRef.current) {
        dotRef.current.style.transform = `translate(${f.mx}px, ${f.my}px)`
        ringX += (f.mx - ringX) * 0.14
        ringY += (f.my - ringY) * 0.14
        ringRef.current.style.transform = `translate(${ringX}px, ${ringY}px)`
      }
    })
    return off
  }, [engine, zones])

  /* Autoplay state → HUD + letterbox. */
  useEffect(() => engine.onPlayChange(setPlaying), [engine])

  /* Grain tile (skipped entirely under reduced motion). */
  useEffect(() => {
    if (engine.reduced || !grainRef.current) return
    grainRef.current.style.backgroundImage = `url(${grainTile()})`
  }, [engine])

  /* Custom cursor region + interactive-element detection. */
  useEffect(() => {
    const root = rootRef.current
    if (!root || !cursorOn) return
    root.classList.add('gf-nocursor')
    const enter = () => setOverRoot(true)
    const leave = () => setOverRoot(false)
    const over = (e: Event) => {
      const target = e.target as HTMLElement | null
      const hot = !!target?.closest('a, button, input, summary, [data-hot]')
      ringRef.current?.classList.toggle('hot', hot)
    }
    root.addEventListener('pointerenter', enter)
    root.addEventListener('pointerleave', leave)
    root.addEventListener('pointerover', over, { passive: true })
    return () => {
      root.classList.remove('gf-nocursor')
      root.removeEventListener('pointerenter', enter)
      root.removeEventListener('pointerleave', leave)
      root.removeEventListener('pointerover', over)
    }
  }, [rootRef, cursorOn])

  /* Keyboard: Space toggles play, ←/→ step through scenes. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const interactive =
        !!el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(el.tagName) || el.isContentEditable)
      if (e.code === 'Space' && !interactive) {
        e.preventDefault()
        engine.toggle()
        return
      }
      if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && !interactive) {
        e.preventDefault()
        const next = Math.min(
          zones.length - 1,
          Math.max(0, zoneIdx.current + (e.code === 'ArrowRight' ? 1 : -1)),
        )
        engine.tweenTo(zoneTops.current[next] ?? 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, zones])

  return (
    <div className={`gf-chrome ${playing ? 'play' : ''}`}>
      {!engine.reduced && (
        <>
          <div className="gf-grain-clip" aria-hidden="true">
            <div className="gf-grain" ref={grainRef} />
          </div>
          <div className="gf-bar t" aria-hidden="true" />
          <div className="gf-bar b" aria-hidden="true" />
        </>
      )}

      <header className="gf-hud">
        <span className="gf-rec">
          <span className="gf-rec-dot" />
          FIELD GUIDE
        </span>
        <span className="gf-sp" />
        <span className="gf-zone">{zoneLabel}</span>
        <span className="gf-tc" ref={tcRef}>TC 00:00:00</span>
        {!engine.reduced && (
          <button
            className="gf-playbtn"
            onClick={() => engine.toggle()}
            aria-label={playing ? 'Pause the guided playthrough' : 'Play the guide like a film'}
          >
            {playing ? '❚❚ PAUSE' : '▶ PLAY'}
          </button>
        )}
        <div className="gf-seek" aria-hidden="false">
          <span className="gf-seek-track" aria-hidden="true" />
          <span className="gf-seek-fill" ref={fillRef} aria-hidden="true" />
          {ticks.map((z) => (
            <button
              key={z.id}
              className={`gf-tick ${zoneLabel === z.label ? 'on' : ''}`}
              style={{ left: `${z.left}%` }}
              title={z.label}
              aria-label={`Jump to ${z.label}`}
              onClick={() => engine.tweenTo(document.getElementById(z.id)?.offsetTop ?? 0)}
            />
          ))}
        </div>
      </header>

      {cursorOn && (
        <>
          <div className={`gf-cur ${overRoot ? 'on' : ''}`} ref={dotRef} aria-hidden="true" />
          <div className={`gf-ring ${overRoot ? 'on' : ''}`} ref={ringRef} aria-hidden="true" />
        </>
      )}
    </div>
  )
}
