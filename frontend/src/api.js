async function jsonRequest(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const j = await res.json()
      if (j.detail) detail = j.detail
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  return res.json()
}

// Lab 1 — Shift Report
export function generateShiftReport(file) {
  const form = new FormData()
  form.append('file', file)
  return jsonRequest('/api/lab1/generate', { method: 'POST', body: form })
}
export function setPreviousShift(file) {
  const form = new FormData()
  form.append('file', file)
  return jsonRequest('/api/lab1/set-previous', { method: 'POST', body: form })
}
export const resetBaseline = () => jsonRequest('/api/lab1/reset-previous', { method: 'POST' })
export const getBaselineInfo = () => jsonRequest('/api/lab1/baseline-info')

// Lab 2 — Permit Query
export function askPermits(question) {
  return jsonRequest('/api/lab2/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
}

// Lab 3 — Work Order Triage
export const getQueue = () => jsonRequest('/api/lab3/queue')
export const triageWorkOrders = () => jsonRequest('/api/lab3/triage', { method: 'POST' })
export const resetTriage = () => jsonRequest('/api/lab3/reset', { method: 'POST' })
export const approveAssignment = (payload) =>
  jsonRequest('/api/lab3/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
