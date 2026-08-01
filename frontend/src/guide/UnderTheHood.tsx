/**
 * The technical layer, collapsed by default.
 *
 * The guide reads as plain English for a clerk or a maintenance lead; a
 * developer opens these to see the actual Agent SDK wiring. Every snippet is
 * copied from the backend source, not paraphrased — the file it came from is
 * cited so it can be checked.
 */
import type { ReactNode } from 'react'
import { Wrench } from '../components/icons'

interface Props {
  summary: string
  source: string
  children: ReactNode
}

export default function UnderTheHood({ summary, source, children }: Props) {
  return (
    <details className="g-hood">
      <summary>
        <Wrench width={13} height={13} />
        <span>{summary}</span>
        <code className="g-hood-src">{source}</code>
      </summary>
      <div className="g-hood-body">{children}</div>
    </details>
  )
}

/** A syntax-free code block — the design system already reads as drafting paper. */
export function Snippet({ lang, children }: { lang?: string; children: string }) {
  return (
    <div className="g-snippet">
      {lang && <span className="g-snippet-lang">{lang}</span>}
      <pre>{children}</pre>
    </div>
  )
}
