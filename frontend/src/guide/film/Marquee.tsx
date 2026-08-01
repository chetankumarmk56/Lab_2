/**
 * A velocity-aware marquee — the one pure flourish in the guide.
 *
 * The strip drifts at walking pace on its own, but it reads the engine's
 * scroll velocity and leans into it: scroll fast and the type accelerates and
 * skews like it has inertia, stop and it settles. Content is tripled so the
 * loop never shows a seam. Off-screen (or under reduced motion) it does no
 * per-frame work at all.
 */
import { useEffect, useRef } from 'react'
import type { FilmEngine } from './useFilm'

export default function Marquee({ engine, items }: { engine: FilmEngine; items: string[] }) {
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || engine.reduced) return

    let x = 0
    let copyW = 1
    let visible = false

    const measure = () => { copyW = strip.scrollWidth / 3 }
    measure()
    if ('fonts' in document) document.fonts.ready.then(measure).catch(() => {})
    window.addEventListener('resize', measure)

    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    io.observe(strip)

    const off = engine.onFrame((f) => {
      if (!visible || document.hidden) return
      x -= 0.85 + Math.min(13, Math.abs(f.vel) * 0.11)
      if (x <= -copyW) x += copyW
      const skew = Math.max(-9, Math.min(9, f.vel * 0.22))
      strip.style.transform = `translate3d(${x}px, 0, 0) skewX(${skew}deg)`
    })

    return () => {
      off()
      io.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [engine])

  const copy = (key: string) => (
    <span className="gf-mq-copy" key={key}>
      {items.map((it, i) => (
        <span key={i}>
          <span className="gf-mq-word">{it}</span>
          <span className="gf-mq-x">✕</span>
        </span>
      ))}
    </span>
  )

  return (
    <div className="gf-mq" aria-hidden="true">
      <div className="gf-mq-strip" ref={stripRef}>
        {copy('a')}{copy('b')}{copy('c')}
      </div>
    </div>
  )
}
