/**
 * The chapter shell every lab section is built on.
 *
 * Two columns: a sticky "stage" that holds still while you scroll, and a column
 * of tall "beats" beside it. The beat nearest the viewport's focus line decides
 * what the stage shows — so scrolling advances an explanation rather than just
 * moving pixels. Below 860px the stage un-sticks and sits above its beats.
 */
import type { ReactNode } from 'react'
import { useActiveBeat } from './useInView'

export interface Beat {
  /** Short label shown in the step rail beside the stage. */
  label: string
  title: string
  body: ReactNode
}

interface ChapterProps {
  id: string
  num: number
  title: string
  sector: string
  /** The one-line thesis: what this lab teaches about bounding an agent. */
  thesis: string
  hook: ReactNode
  beats: Beat[]
  /** Rendered with the index of the active beat so it can animate per step. */
  stage: (active: number) => ReactNode
  children?: ReactNode
}

export default function Chapter({
  id, num, title, sector, thesis, hook, beats, stage, children,
}: ChapterProps) {
  const { setBeatRef, active } = useActiveBeat(beats.length)

  return (
    <section className="g-chapter" id={id} aria-labelledby={`${id}-title`}>
      <header className="g-ch-head">
        <div className="g-ch-eyebrow">
          <span className="g-ch-num">{String(num).padStart(2, '0')}</span>
          <span className="g-ch-sector">{sector}</span>
        </div>
        <h2 className="g-ch-title" id={`${id}-title`}>{title}</h2>
        <p className="g-ch-thesis">{thesis}</p>
        <div className="g-ch-hook">{hook}</div>
      </header>

      <div className="g-ch-body">
        <div className="g-stage-col">
          <div className="g-stage">
            <div className="g-steprail" aria-hidden="true">
              {beats.map((b, i) => (
                <span key={b.label} className={`g-steprail-dot ${i === active ? 'on' : ''} ${i < active ? 'done' : ''}`}>
                  <em>{b.label}</em>
                </span>
              ))}
            </div>
            <div className="g-stage-inner">{stage(active)}</div>
          </div>
        </div>

        <ol className="g-beats">
          {beats.map((b, i) => (
            <li
              key={b.label}
              ref={setBeatRef(i)}
              className={`g-beat ${i === active ? 'on' : ''}`}
              aria-current={i === active ? 'step' : undefined}
            >
              <span className="g-beat-label">{b.label}</span>
              <h3 className="g-beat-title">{b.title}</h3>
              <div className="g-beat-body">{b.body}</div>
            </li>
          ))}
        </ol>
      </div>

      {children}
    </section>
  )
}
