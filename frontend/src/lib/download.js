/* Client-side download helpers shared by every lab. */

/** Trigger a browser download of `content` as `filename`. */
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Quote a single CSV cell per RFC 4180 (wrap + double any inner quotes). */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build a CSV string from a header row and rows-of-arrays. */
export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\r\n')
}

/** Build a CSV from objects, given [{ key, label }] column specs. */
export function objectsToCsv(items, columns) {
  const headers = columns.map((c) => c.label)
  const rows = items.map((it) => columns.map((c) => it[c.key]))
  return toCsv(headers, rows)
}

/** Timestamp suffix (YYYY-MM-DD-HHmm) for unique-ish download names. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
