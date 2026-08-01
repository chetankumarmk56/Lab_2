import { jsonPost, request } from './client'
import type {
  Lab7Config,
  PlanResponse,
  RecordedRun,
  ResearchEvent,
  ResearchPlan,
  RunSummary,
} from '../types'

export const getLab7Config = () => request<Lab7Config>('/api/lab7/config')

export const planResearch = (question: string, breadth: number) =>
  request<PlanResponse>('/api/lab7/plan', jsonPost({ question, breadth }))

export const listRuns = () => request<{ runs: RunSummary[] }>('/api/lab7/runs')

export const getRunEvents = (runId: string) => request<RecordedRun>(`/api/lab7/runs/${runId}`)

export const deleteRun = (runId: string) =>
  request<{ ok: boolean }>(`/api/lab7/runs/${runId}`, { method: 'DELETE' })

async function readNdjson(res: Response, onEvent: (event: ResearchEvent) => void): Promise<void> {
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
      if (line) onEvent(JSON.parse(line) as ResearchEvent)
    }
  }
  const tail = buffer.trim()
  if (tail) onEvent(JSON.parse(tail) as ResearchEvent)
}

/** Planned (workflow) mode: execute an approved plan; events stream live. */
export async function runResearchStream(
  question: string,
  plan: ResearchPlan,
  onEvent: (event: ResearchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/lab7/run/stream', { ...jsonPost({ question, plan }), signal })
  await readNdjson(res, onEvent)
}

/** Agent-loop (autonomous) mode: no pre-plan — the lead agent decides each step.
 *  `maxResearchers` lowers this run's budget rail so it can be demoed firing. */
export async function runDynamicResearchStream(
  question: string,
  maxResearchers: number,
  onEvent: (event: ResearchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/lab7/run-dynamic/stream', {
    ...jsonPost({ question, max_researchers: maxResearchers }),
    signal,
  })
  await readNdjson(res, onEvent)
}
