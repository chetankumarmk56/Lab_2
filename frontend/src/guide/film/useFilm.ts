/**
 * The film engine behind the guide's motion.
 *
 * One requestAnimationFrame loop owns every scroll-linked effect on the route.
 * Components subscribe with `onFrame()` and read the same eased values, so the
 * HUD, the hero canvas and the scrub scenes all agree on where the "playhead"
 * is — and unmounting the route tears everything down in one place.
 *
 * The numbers are tuned deliberately soft (the brief: smooth, and a little
 * slower than a typical scroll site). Scroll is eased with a ~220ms time
 * constant, velocity with ~120ms, and autoplay crawls at reading pace.
 * Everything is dt-based, so a 144Hz display feels the same as 60Hz.
 *
 * prefers-reduced-motion collapses the easing (smooth === real scroll) and
 * disables autoplay; the chrome hides its decorative layers via CSS.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { RefCallback } from 'react'

/** Autoplay speed in px/s — also defines the timecode's "runtime". */
export const PLAY_PXPS = 175

const SCROLL_TAU = 0.22
const VEL_TAU = 0.12
const MOUSE_TAU = 0.1

export interface FilmFrame {
  /** Real window.scrollY this frame. */
  y: number
  /** Eased scroll — drive transforms from this, never from `y`. */
  smooth: number
  /** Eased velocity in px per 60fps-frame (signed). */
  vel: number
  /** 0..1 through the document's scrollable height (from `smooth`). */
  progress: number
  /** scrollHeight - innerHeight, re-measured on resize. */
  docH: number
  /** Raw pointer position (client px) and pressed state. */
  mx: number
  my: number
  down: boolean
  /** Eased pointer position. */
  smx: number
  smy: number
  /** rAF timestamp. */
  t: number
}

export interface FilmEngine {
  readonly reduced: boolean
  readonly finePointer: boolean
  /** Subscribe to the master loop. Returns an unsubscribe function. */
  onFrame(fn: (f: FilmFrame) => void): () => void
  /** Subscribe to autoplay state changes. Returns an unsubscribe function. */
  onPlayChange(fn: (playing: boolean) => void): () => void
  /** Re-measure the document (call after layout-affecting changes). */
  measure(): void
  /** Animated scroll to a document offset. Cancelled by any user scroll. */
  tweenTo(target: number, ms?: number): void
  play(): void
  pause(): void
  toggle(): void
  playing(): boolean
  /** Internal lifecycle — called by useFilmEngine. */
  start(): void
  stop(): void
}

function createEngine(): FilmEngine {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const finePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

  const frame: FilmFrame = {
    y: 0, smooth: 0, vel: 0, progress: 0, docH: 1,
    mx: -100, my: -100, down: false, smx: -100, smy: -100, t: 0,
  }

  const frameFns = new Set<(f: FilmFrame) => void>()
  const playFns = new Set<(p: boolean) => void>()

  let raf = 0
  let tweenRaf = 0
  let running = false
  let last = 0
  let prevSmooth = 0
  let isPlaying = false
  let playSpeed = 0

  const measure = () => {
    frame.docH = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  }

  const setPlaying = (p: boolean) => {
    if (isPlaying === p) return
    isPlaying = p
    playSpeed = 0
    playFns.forEach((fn) => fn(p))
  }

  const cancelTween = () => {
    if (tweenRaf) cancelAnimationFrame(tweenRaf)
    tweenRaf = 0
  }

  /** Any real user scroll intent takes the wheel back from the machine. */
  const onUserScroll = () => {
    cancelTween()
    setPlaying(false)
  }

  const onPointerMove = (e: PointerEvent) => {
    frame.mx = e.clientX
    frame.my = e.clientY
    // First-ever move: snap the eased position so the ring doesn't fly in.
    if (frame.smx < -50) { frame.smx = e.clientX; frame.smy = e.clientY }
  }
  const onPointerDown = () => { frame.down = true }
  const onPointerUp = () => { frame.down = false }
  const onResize = () => measure()

  const loop = (t: number) => {
    const dt = last ? Math.min(0.064, (t - last) / 1000) : 0.016
    last = t
    frame.t = t
    frame.y = window.scrollY

    if (reduced) {
      frame.smooth = frame.y
    } else {
      frame.smooth += (frame.y - frame.smooth) * (1 - Math.exp(-dt / SCROLL_TAU))
      if (Math.abs(frame.y - frame.smooth) < 0.06) frame.smooth = frame.y
    }

    const instVel = (frame.smooth - prevSmooth) / Math.max(dt, 0.001) / 60
    frame.vel += (instVel - frame.vel) * (1 - Math.exp(-dt / VEL_TAU))
    prevSmooth = frame.smooth

    const km = 1 - Math.exp(-dt / MOUSE_TAU)
    frame.smx += (frame.mx - frame.smx) * km
    frame.smy += (frame.my - frame.smy) * km

    if (isPlaying) {
      playSpeed += (PLAY_PXPS - playSpeed) * (1 - Math.exp(-dt / 0.8))
      window.scrollTo(0, frame.y + playSpeed * dt)
      if (frame.y >= frame.docH - 2) setPlaying(false)
    }

    frame.progress = Math.min(1, Math.max(0, frame.smooth / frame.docH))

    frameFns.forEach((fn) => fn(frame))
    if (running) raf = requestAnimationFrame(loop)
  }

  const tweenTo = (target: number, ms = 1350) => {
    setPlaying(false)
    cancelTween()
    if (reduced) {
      window.scrollTo(0, target)
      return
    }
    const from = window.scrollY
    const t0 = performance.now()
    const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      window.scrollTo(0, from + (target - from) * ease(p))
      tweenRaf = p < 1 ? requestAnimationFrame(step) : 0
    }
    tweenRaf = requestAnimationFrame(step)
  }

  const play = () => {
    if (reduced) return
    cancelTween()
    measure()
    // "Replay" from the end: cut back to the top, then roll.
    if (window.scrollY >= frame.docH - 8) {
      window.scrollTo(0, 0)
      frame.smooth = 0
      prevSmooth = 0
    }
    setPlaying(true)
  }
  const pause = () => setPlaying(false)

  return {
    reduced,
    finePointer,

    onFrame(fn) {
      frameFns.add(fn)
      return () => frameFns.delete(fn)
    },
    onPlayChange(fn) {
      playFns.add(fn)
      return () => playFns.delete(fn)
    },
    measure,
    tweenTo,
    play,
    pause,
    toggle() { (isPlaying ? pause : play)() },
    playing() { return isPlaying },

    start() {
      if (running) return
      running = true
      last = 0
      frame.smooth = window.scrollY
      prevSmooth = frame.smooth
      measure()
      window.addEventListener('wheel', onUserScroll, { passive: true })
      window.addEventListener('touchstart', onUserScroll, { passive: true })
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('pointerdown', onPointerDown, { passive: true })
      window.addEventListener('pointerup', onPointerUp, { passive: true })
      window.addEventListener('resize', onResize)
      raf = requestAnimationFrame(loop)
    },
    stop() {
      if (!running) return
      running = false
      setPlaying(false)
      cancelTween()
      cancelAnimationFrame(raf)
      window.removeEventListener('wheel', onUserScroll)
      window.removeEventListener('touchstart', onUserScroll)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('resize', onResize)
    },
  }
}

/**
 * Creates the engine once per mount of the guide and manages its lifecycle.
 * start/stop are idempotent, so StrictMode's double-effect in dev is harmless.
 */
export function useFilmEngine(): FilmEngine {
  const ref = useRef<FilmEngine | null>(null)
  if (!ref.current) ref.current = createEngine()
  useEffect(() => {
    const engine = ref.current
    if (!engine) return
    engine.start()
    return () => engine.stop()
  }, [])
  return ref.current
}

/**
 * Magnetic hover: the element leans toward the cursor while it is near, and
 * springs home when it leaves. Soft on purpose — the pull eases through a
 * short transition rather than tracking 1:1. No-op for coarse pointers and
 * reduced motion.
 */
export function useMagnet<T extends HTMLElement>(engine: FilmEngine, strength = 0.18): RefCallback<T> {
  const cleanup = useRef<(() => void) | null>(null)

  return useCallback(
    (node: T | null) => {
      cleanup.current?.()
      cleanup.current = null
      if (!node || !engine.finePointer || engine.reduced) return

      const onMove = (e: PointerEvent) => {
        const r = node.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        node.style.transition = 'transform 0.18s ease-out'
        node.style.transform = `translate(${dx * strength}px, ${dy * strength * 1.3}px)`
      }
      const onLeave = () => {
        node.style.transition = 'transform 0.65s cubic-bezier(0.22, 1, 0.36, 1)'
        node.style.transform = ''
      }
      node.addEventListener('pointermove', onMove)
      node.addEventListener('pointerleave', onLeave)
      cleanup.current = () => {
        node.removeEventListener('pointermove', onMove)
        node.removeEventListener('pointerleave', onLeave)
        node.style.transform = ''
        node.style.transition = ''
      }
    },
    [engine, strength],
  )
}
