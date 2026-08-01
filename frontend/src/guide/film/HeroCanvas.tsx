/**
 * The hero's living background: a flow-field of drafting dust.
 *
 * A few hundred particles ride a slowly-turning sine field, drawn onto a
 * transparent canvas with fading trails, so the blueprint grid shows through
 * beneath them. The cursor repels them gently; holding the pointer down pulls
 * them in instead. Colors are read from the live theme tokens (and re-read
 * when data-theme flips), so light and dark both look intentional.
 *
 * The canvas only draws while the hero is on screen and the tab is visible;
 * particle count scales with pointer type. Reduced motion renders nothing.
 */
import { useEffect, useRef } from 'react'
import type { FilmEngine } from './useFilm'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  accent: boolean
}

const DPR_CAP = 1.5

export default function HeroCanvas({ engine }: { engine: FilmEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || engine.reduced) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let visible = true
    let colAccent = '#3b5bdb'
    let colInk = '20, 29, 43'

    /** Pull the current theme's colors out of the CSS tokens. */
    const readTheme = () => {
      const styles = getComputedStyle(document.documentElement)
      colAccent = styles.getPropertyValue('--accent').trim() || colAccent
      const ink = styles.getPropertyValue('--ink').trim()
      // --ink is a hex token in this app; expand to an rgb triple for alpha use.
      const m = /^#([0-9a-f]{6})$/i.exec(ink)
      if (m) {
        const n = parseInt(m[1], 16)
        colInk = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
      }
    }
    readTheme()
    const themeWatch = new MutationObserver(readTheme)
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const particles: Particle[] = []
    const seed = () => {
      const target = engine.finePointer ? Math.min(460, Math.round((w * h) / 3400)) : 180
      particles.length = 0
      for (let i = 0; i < target; i++) {
        particles.push({
          x: Math.random(), y: Math.random(), vx: 0, vy: 0,
          accent: Math.random() < 0.22,
        })
      }
    }

    const size = () => {
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      seed()
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(canvas)

    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    io.observe(canvas)

    const offFrame = engine.onFrame((f) => {
      if (!visible || document.hidden) return

      // Fade the previous frame toward transparent — this is what draws trails.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.07)'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'

      const rect = canvas.getBoundingClientRect()
      const mX = f.smx - rect.left
      const mY = f.smy - rect.top
      const T = f.t * 0.00013

      for (const p of particles) {
        const px = p.x * w
        const py = p.y * h
        const angle =
          (Math.sin(px * 0.0015 + T * 2.0) +
            Math.cos(py * 0.0013 - T * 1.6) +
            Math.sin((px + py) * 0.0007 + T)) * Math.PI

        p.vx += Math.cos(angle) * 0.02
        p.vy += Math.sin(angle) * 0.02

        const dx = px - mX
        const dy = py - mY
        const d2 = dx * dx + dy * dy
        if (d2 < 24000) {
          const d = Math.sqrt(d2) || 1
          const force = (1 - d / 155) * (f.down ? -0.62 : 0.38)
          p.vx += (dx / d) * force
          p.vy += (dy / d) * force
        }

        p.vx *= 0.95
        p.vy *= 0.95
        p.x += p.vx / w
        p.y += p.vy / h
        if (p.x < 0) p.x += 1
        if (p.x > 1) p.x -= 1
        if (p.y < 0) p.y += 1
        if (p.y > 1) p.y -= 1

        const speed = Math.abs(p.vx) + Math.abs(p.vy)
        ctx.globalAlpha = Math.min(0.8, 0.2 + speed * 0.3)
        ctx.fillStyle = p.accent ? colAccent : `rgba(${colInk}, 0.55)`
        const s = p.accent ? 1.9 : 1.3
        ctx.fillRect(p.x * w, p.y * h, s, s)
      }
      ctx.globalAlpha = 1
    })

    return () => {
      offFrame()
      ro.disconnect()
      io.disconnect()
      themeWatch.disconnect()
    }
  }, [engine])

  if (engine.reduced) return null
  return <canvas ref={canvasRef} className="gf-canvas" aria-hidden="true" />
}
