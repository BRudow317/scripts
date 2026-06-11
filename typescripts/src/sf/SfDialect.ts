/**
 * SfDialect.ts
 *
 * SOQL escaping/quoting utilities, ported from src/sf/SfDialect.py. Python's
 * string.Formatter-based `format_soql` has no direct Node equivalent; the
 * value-quoting helpers it relied on are ported here, which is the part the rest
 * of the engine actually needs.
 */

const SOQL_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
}

function translate(value: string, table: Record<string, string>): string {
  let out = ''
  for (const ch of value) out += table[ch] ?? ch
  return out
}

/** Quote/escape an individual value (or list) for a SOQL value expression. */
export function quoteSoqlValue(value: unknown): string {
  if (typeof value === 'string') return "'" + translate(value, SOQL_ESCAPES) + "'"
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return '(' + value.map((m) => quoteSoqlValue(m)).join(',') + ')'
  if (value instanceof Date) return value.toISOString()
  throw new Error('unquotable value type')
}

/** Escape a scalar value for safe SOQL interpolation. */
export function escapeSoqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (value instanceof Date) return value.toISOString()
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `'${escaped}'`
}

/** Create an external ID string for use with get() or upsert(). */
export function formatExternalId(field: string, value: string): string {
  return field + '/' + encodeURIComponent(value)
}

/** Best-effort parse of the main object name from a SOQL query string. */
export function getObjectFromSoql(soql: string): string | null {
  const noParens = soql.replace(/\(.*?\)/g, '')
  const match = noParens.match(/\bFROM\s+([a-zA-Z0-9_]+)/i)
  return match ? match[1] : null
}

export function buildCountSoql(objectName: string): string {
  return `SELECT COUNT() FROM ${objectName}`
}

export function buildNullCheckSoql(objectName: string, columnName: string): string {
  return `SELECT COUNT() FROM ${objectName} WHERE ${columnName} = null`
}

export function filterNullBytes(b: string): string {
  return b.replace(/\x00/g, '')
}
