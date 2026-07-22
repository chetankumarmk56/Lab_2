/** Shared fetch client. Throws Error(detail) on non-2xx, using the backend's
 *  `{ detail }` message when present. */
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: string }
      if (body.detail) detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }
  return (await res.json()) as T
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
