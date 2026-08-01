/**
 * Parse a database connection string into the fields the Lab 5 wizard collects.
 *
 * Three shapes are accepted, because these are the three people actually have
 * on their clipboard:
 *   1. URI       postgresql://user:pass@host:5432/db?sslmode=require
 *                (also postgres://, mysql://, mariadb://, sqlserver://, mssql://,
 *                 and jdbc:-prefixed variants)
 *   2. libpq     host=db.example.com port=5432 dbname=analytics user=ro password=…
 *   3. ADO.NET   Server=tcp:host,1433;Database=analytics;User Id=ro;Password=…
 *
 * Parsing happens entirely in the browser and the result is dropped straight
 * into the existing form fields, so the API contract is unchanged and the
 * password travels the same path as a typed one.
 */

export type DriverId = 'postgres' | 'mysql' | 'mssql'

export interface ParsedConnection {
  driver?: DriverId
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  sslMode?: string
  /** Things worth telling the user rather than silently guessing about. */
  warnings: string[]
}

const SCHEME_DRIVERS: Record<string, DriverId> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  psql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  mssql: 'mssql',
  sqlserver: 'mssql',
}

/** Percent-decoding that survives a password containing a stray '%'. */
function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toPort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined
}

/** sslmode=require / Encrypt=true / ssl=true all mean "turn TLS on". */
function normaliseSsl(key: string, value: string): string | undefined {
  const k = key.toLowerCase().replace(/[\s_]/g, '')
  if (k === 'sslmode') return value
  if (k === 'ssl' || k === 'encrypt' || k === 'usessl') {
    const on = /^(true|yes|1|require|required)$/i.test(value.trim())
    return on ? 'require' : undefined
  }
  return undefined
}

/** Shape 1 — anything with a scheme and `//`. */
function parseUri(raw: string): ParsedConnection | null {
  // jdbc:postgresql://… — drop the wrapper and parse what's inside.
  const input = raw.replace(/^jdbc:/i, '')
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input)
  if (!schemeMatch) return null

  const scheme = schemeMatch[1].toLowerCase().split('+')[0] // postgresql+psycopg → postgresql
  const out: ParsedConnection = { warnings: [] }
  out.driver = SCHEME_DRIVERS[scheme]
  if (!out.driver) out.warnings.push(`Unrecognised scheme "${scheme}" — pick the engine yourself.`)

  const rest = input.slice(schemeMatch[0].length)
  const [beforeQuery, query = ''] = rest.split(/[?]/, 2)
  const at = beforeQuery.lastIndexOf('@') // last '@': passwords may contain one
  const authority = at === -1 ? beforeQuery : beforeQuery.slice(at + 1)
  const credentials = at === -1 ? '' : beforeQuery.slice(0, at)

  if (credentials) {
    const colon = credentials.indexOf(':')
    if (colon === -1) {
      out.username = decode(credentials)
    } else {
      out.username = decode(credentials.slice(0, colon))
      out.password = decode(credentials.slice(colon + 1))
    }
  }

  const slash = authority.indexOf('/')
  const hostPart = slash === -1 ? authority : authority.slice(0, slash)
  const dbPart = slash === -1 ? '' : authority.slice(slash + 1)
  if (dbPart) out.database = decode(dbPart.replace(/\/+$/, ''))

  // IPv6 literals are bracketed: [::1]:5432
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPart)
  if (v6) {
    out.host = v6[1]
    out.port = toPort(v6[2])
  } else {
    const [h, p] = hostPart.split(':')
    if (h) out.host = decode(h)
    out.port = toPort(p)
  }

  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = decode(pair.slice(0, eq))
    const value = decode(pair.slice(eq + 1))
    const ssl = normaliseSsl(key, value)
    if (ssl) out.sslMode = ssl
    const k = key.toLowerCase()
    // Some drivers carry credentials in the query string instead of the authority.
    if (k === 'user' || k === 'username' || k === 'uid') out.username ||= value
    if (k === 'password' || k === 'pwd') out.password ||= value
    if (k === 'database' || k === 'dbname') out.database ||= value
  }

  return out.host ? out : null
}

/** Shapes 2 and 3 — `key=value` separated by semicolons or whitespace. */
function parseKeyValue(raw: string): ParsedConnection | null {
  // Semicolons win when present: ADO.NET keys contain spaces ("User Id",
  // "Initial Catalog"), so splitting those on whitespace tears them in half.
  // libpq strings use spaces but never spaces inside a key.
  const parts = (raw.includes(';') ? raw.split(';') : raw.split(/\s+/))
    .map((p) => p.trim())
    .filter(Boolean)
  const pairs = parts
    .map((p) => {
      const eq = p.indexOf('=')
      return eq === -1 ? null : ([p.slice(0, eq), p.slice(eq + 1)] as const)
    })
    .filter(Boolean) as (readonly [string, string])[]
  if (!pairs.length) return null

  const out: ParsedConnection = { warnings: [] }
  let sawAdoServer = false

  for (const [rawKey, rawValue] of pairs) {
    const key = rawKey.toLowerCase().replace(/[\s_]/g, '')
    const value = rawValue.replace(/^['"]|['"]$/g, '')

    const ssl = normaliseSsl(rawKey, value)
    if (ssl) out.sslMode = ssl

    switch (key) {
      case 'host':
      case 'hostname':
      case 'server':
      case 'datasource':
      case 'addr':
      case 'address': {
        sawAdoServer = key === 'server' || key === 'datasource'
        // ADO.NET packs host and port together: tcp:db.example.com,1433
        const cleaned = value.replace(/^tcp:/i, '')
        const comma = cleaned.lastIndexOf(',')
        if (comma !== -1 && toPort(cleaned.slice(comma + 1))) {
          out.host = cleaned.slice(0, comma)
          out.port = toPort(cleaned.slice(comma + 1))
        } else {
          out.host = cleaned
        }
        break
      }
      case 'port':
        out.port = toPort(value) ?? out.port
        break
      case 'dbname':
      case 'database':
      case 'initialcatalog':
        out.database = value
        break
      case 'user':
      case 'username':
      case 'userid':
      case 'uid':
        out.username = value
        break
      case 'password':
      case 'pwd':
        out.password = value
        break
    }
  }

  if (!out.host) return null
  // Infer the engine from dialect-specific key names.
  const keys = pairs.map(([k]) => k.toLowerCase().replace(/[\s_]/g, ''))
  if (keys.includes('dbname')) out.driver = 'postgres'
  else if (keys.includes('initialcatalog') || sawAdoServer) out.driver = 'mssql'
  if (!out.driver) out.warnings.push('Could not tell which engine this is — pick it yourself.')
  return out
}

/**
 * Returns the fields found in `raw`, or null when it isn't a connection string
 * at all. Never throws: this runs on every keystroke.
 */
export function parseConnectionString(raw: string): ParsedConnection | null {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '')
  if (!trimmed) return null
  try {
    return parseUri(trimmed) ?? parseKeyValue(trimmed)
  } catch {
    return null
  }
}

/** Human-readable summary of what was extracted, with the password masked. */
export function describeParsed(p: ParsedConnection): string {
  const user = p.username ? `${p.username}@` : ''
  const port = p.port ? `:${p.port}` : ''
  const db = p.database ? `/${p.database}` : ''
  return `${user}${p.host ?? '?'}${port}${db}`
}
