/** An Error enriched with the HTTP status and the raw `detail` from the backend
 *  (so callers can read structured field errors). */
export interface ApiError extends Error {
  status?: number
  detail?: unknown
}

/** Shared fetch client. Throws an ApiError on non-2xx, with a readable message
 *  derived from the backend's `detail` (string, {message, fields}, or 422 array). */
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    let detail: unknown = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body && body.detail !== undefined) detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw toApiError(detail, res.status)
  }
  return (await res.json()) as T
}

function toApiError(detail: unknown, status: number): ApiError {
  let message: string
  if (typeof detail === 'string') {
    message = detail
  } else if (Array.isArray(detail)) {
    // FastAPI 422: [{ loc: [...], msg: "..." }, ...]
    message = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d)))
      .join('; ')
  } else if (detail && typeof detail === 'object' && 'message' in detail) {
    message = String((detail as { message: unknown }).message)
  } else {
    message = 'Request failed.'
  }
  const err = new Error(message) as ApiError
  err.status = status
  err.detail = detail
  return err
}

/** Build a JSON POST request init. */
export function jsonPost(data: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}

/** Build a multipart POST request init from a single file field. */
export function filePost(field: string, file: File): RequestInit {
  const form = new FormData()
  form.append(field, file)
  return { method: 'POST', body: form }
}
