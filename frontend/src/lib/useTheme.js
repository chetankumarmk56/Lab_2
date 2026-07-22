import { useCallback, useEffect, useState } from 'react'

const KEY = 'labs-theme'

/**
 * Theme hook. The initial theme is applied pre-paint by an inline script in
 * index.html (which sets <html data-theme>), so here we just read it back and
 * keep it in sync with a manual toggle that persists to localStorage.
 */
export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'light',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* storage may be unavailable — non-fatal */
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle }
}
