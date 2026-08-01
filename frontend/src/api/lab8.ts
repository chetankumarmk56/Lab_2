import { jsonPost, request } from './client'
import type { EvalEvent, EvalRunSummary, EvalSuitesResponse } from '../types'

export const getEvalSuites = () => request<EvalSuitesResponse>('/api/lab8/suites')

export const listEvalRuns = () => request<{ runs: EvalRunSummary[] }>('/api/lab8/results')

export const deleteEvalRun = (runId: string) =>
  request<{ ok: boolean }>(`/api/lab8/results/${runId}`, { method: 'DELETE' })

/** Run selected suites; case-by-case results stream to `onEvent` as they land. */
export async function runEvalsStream(
  suites: string[],
  model: string | null,
  judge: boolean,
  onEvent: (event: EvalEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/lab8/run/stream', {
    ...jsonPost({ suites, model, judge }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as EvalEvent)
    }
  }
  const tail = buffer.trim()
  if (tail) onEvent(JSON.parse(tail) as EvalEvent)
}
