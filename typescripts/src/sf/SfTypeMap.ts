/**
 * SfTypeMap.ts
 *
 * Salesforce field-type mapping and value conversion, ported from
 * src/sf/SfTypeMap.py. JS has no Decimal/date/time types, so: currency is kept
 * as a numeric string (precision-preserving for the downstream Oracle NUMBER
 * bind), date/datetime become Date, and time stays a string (Oracle stores time
 * as VARCHAR2).
 */
import { PythonTypes, type Row } from '../models.js'

export const SF_TYPE_MAP: Record<string, PythonTypes> = {
  id: PythonTypes.string,
  string: PythonTypes.string,
  textarea: PythonTypes.string,
  email: PythonTypes.string,
  phone: PythonTypes.string,
  url: PythonTypes.string,
  encryptedstring: PythonTypes.string,
  picklist: PythonTypes.string,
  multipicklist: PythonTypes.string,
  combobox: PythonTypes.string,
  reference: PythonTypes.string,
  anytype: PythonTypes.string,
  int: PythonTypes.integer,
  integer: PythonTypes.integer,
  long: PythonTypes.integer,
  double: PythonTypes.float,
  currency: PythonTypes.float,
  percent: PythonTypes.float,
  boolean: PythonTypes.boolean,
  date: PythonTypes.date,
  datetime: PythonTypes.datetime,
  time: PythonTypes.time,
  base64: PythonTypes.byte,
  complexvalue: PythonTypes.json,
  address: PythonTypes.json,
  location: PythonTypes.json,
}

/**
 * Map a Salesforce describe field `type` to a PythonType. Unknown types fall
 * back to string (with a warning) so a single exotic field can't abort a full
 * schema migration.
 */
export function sfTypeToPython(sfType: string): PythonTypes {
  const mapped = SF_TYPE_MAP[sfType.toLowerCase()]
  if (mapped === undefined) {
    console.warn("Unmapped Salesforce field type '%s'; defaulting to string.", sfType)
    return PythonTypes.string
  }
  return mapped
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  return String(v).toLowerCase() === 'true'
}

function toDatetime(v: string): Date {
  let s = v
  if (s.endsWith('Z')) {
    s = s.slice(0, -1) + '+00:00'
  } else if (s.length > 5 && (s[s.length - 5] === '+' || s[s.length - 5] === '-') && !s.slice(-5).includes(':')) {
    s = s.slice(0, -2) + ':' + s.slice(-2)
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`invalid datetime: ${v}`)
  return d
}

function toDateOnly(v: string): Date {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) throw new Error(`invalid date: ${v}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function toTime(v: string): string {
  return typeof v === 'string' && v.endsWith('Z') ? v.slice(0, -1) : v
}

const SF_CONVERTERS: Record<string, (v: unknown) => unknown> = {
  int: (v) => {
    const n = Number(v)
    if (!Number.isInteger(n)) throw new Error('not int')
    return n
  },
  integer: (v) => {
    const n = Number(v)
    if (!Number.isInteger(n)) throw new Error('not int')
    return n
  },
  long: (v) => {
    const n = Number(v)
    if (!Number.isInteger(n)) throw new Error('not int')
    return n
  },
  double: (v) => {
    const n = Number(v)
    if (Number.isNaN(n)) throw new Error('not a number')
    return n
  },
  percent: (v) => {
    const n = Number(v)
    if (Number.isNaN(n)) throw new Error('not a number')
    return n
  },
  // Keep currency as a numeric string to preserve precision (Decimal in Python).
  currency: (v) => String(v),
  boolean: toBool,
  date: (v) => toDateOnly(String(v)),
  datetime: (v) => toDatetime(String(v)),
  time: (v) => toTime(String(v)),
}

/** Convert a Salesforce field value to its native JS type. */
export function sfToPython(sfType: string, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null
  const converter = SF_CONVERTERS[sfType]
  if (converter) {
    try {
      return converter(value)
    } catch {
      return value
    }
  }
  return value
}

/** Apply sfToPython to each field using a {fieldName: sfType} map. */
export function castRecord(record: Row, fieldTypes: Record<string, string>): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(record)) {
    out[k] = k in fieldTypes ? sfToPython(fieldTypes[k], v) : v
  }
  return out
}

/** Sentinel for explicit null writes to Salesforce. */
export const CLEAR = Symbol('CLEAR')

/** Convert a JS value to its Salesforce API string representation. */
export function pythonToSf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Convert JS values to SF API representation. Use CLEAR to explicitly null a
 * field; omit a key entirely to leave the field unchanged.
 */
export function prepareRecord(record: Record<string, unknown>): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(record)) {
    if (v === CLEAR) {
      out[k] = null
    } else if (v !== null && v !== undefined) {
      out[k] = pythonToSf(v)
    }
  }
  return out
}
