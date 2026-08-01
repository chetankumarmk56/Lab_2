/**
 * Scroll hooks for the guide.
 *
 * Motion is split deliberately: CSS owns the *decoration* (reveals, parallax,
 * line-drawing) via scroll-driven `animation-timeline`, which runs off the main
 * thread. These hooks own the *state* — which beat of a chapter is currently
 * being read — because CSS cannot drive one element's content from another
 * element's scroll position.
 */
import { useEffect, useRef, useState } from 'react'

/** True when the user has asked the OS to reduce motion. Live-updates. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * Fires once when the element first crosses into view. Used as the fallback
 * reveal for engines without scroll-driven animations, and as the "start
 * playing" trigger for the transcript replay.
 */
export function useInView<T extends HTMLElement>(rootMargin = '-12% 0px -12% 0px') {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // No IntersectionObserver (or SSR): show everything rather than hide it.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          io.disconnect() // one-way: never un-reveal something already read
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])

  return { ref, inView }
}

/**
 * Tracks which of N stacked "beats" is currently the focus of the viewport, so
 * a sticky stage beside them can render the matching step.
 *
 * Picks the beat whose centre is nearest the focus line (40% down the viewport)
 * rather than trusting observer ordering — with tall beats, several can be
 * intersecting at once and "last one to fire" gives the wrong answer when
 * scrolling upward.
 */
export function useActiveBeat(count: number) {
  const refs = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (count === 0) return

    let frame = 0
    const measure = () => {
      frame = 0
      const focus = window.innerHeight * 0.4
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      refs.current.forEach((el, i) => {
        if (!el) return
        const box = el.getBoundingClientRect()
        const distance = Math.abs(box.top + box.height / 2 - focus)
        if (distance < bestDistance) {
          bestDistance = distance
          best = i
        }
      })
      setActive((prev) => (prev === best ? prev : best))
    }

    // rAF-throttled: scroll fires far more often than we can usefully re-render.
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [count])

  const setBeatRef = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el
  }

  return { setBeatRef, active }
}
