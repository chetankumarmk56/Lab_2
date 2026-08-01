import { jsonPost, request } from './client'
import type { PermitAnswer, PermitDataset, PermitStreamEvent } from '../types'

export const askPermits = (question: string) =>
  request<PermitAnswer>('/api/lab2/ask', jsonPost({ question }))

export const getPermitDataset = () => request<PermitDataset>('/api/lab2/dataset')

/**
 * Stream a permit answer as newline-delimited JSON events. Resolves when the
 * stream ends; each parsed event is delivered to `onEvent` as it arrives.
 */
export async function askPermitsStream(
  question: string,
  onEvent: (event: PermitStreamEvent) => void,
): Promise<void> {
  const res = await fetch('/api/lab2/ask/stream', jsonPost({ question }))
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
      if (line) onEvent(JSON.parse(line) as PermitStreamEvent)
    }
  }
  const tail = buffer.trim()
  if (tail) onEvent(JSON.parse(tail) as PermitStreamEvent)
}
