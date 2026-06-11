/**
 * OracleTypeMap.ts
 *
 * Source of truth for Oracle <-> Python(Type) <-> JS value conversions, ported
 * from src/oracle/OracleTypeMap.py. Where Python used datetime/Decimal, Node
 * uses the native Date and number/string (numeric strings preserve precision for
 * values outside the safe-integer range when binding to Oracle NUMBER columns).
 */
import { Column, PythonTypes, Table } from '../models.js'
import {
  OracleColumn,
  type OracleColumnInit,
  OracleTable,
  COMMA_RE,
  NULL_BYTE_RE,
} from './OracleModels.js'

export function oracleToPython(
  rawType: string,
  scale: number | null = null,
  _maxLength: number | null = null,
): PythonTypes {
  const u = rawType.toUpperCase()

  if (u === 'CLOB' || u === 'NCLOB' || u === 'ROWID' || u === 'UROWID') {
    return PythonTypes.string
  }
  if (u === 'VARCHAR2' || u === 'NVARCHAR2' || u === 'CHAR' || u === 'NCHAR') {
    return PythonTypes.string
  }
  if (u === 'NUMBER') {
    return scale === 0 ? PythonTypes.integer : PythonTypes.float
  }
  if (u === 'FLOAT' || u === 'BINARY_FLOAT' || u === 'BINARY_DOUBLE') {
    return PythonTypes.float
  }
  if (u.includes('TIMESTAMP')) {
    return PythonTypes.datetime
  }
  if (u === 'DATE') {
    return PythonTypes.date
  }
  if (u === 'BLOB' || u === 'RAW' || u === 'LONG RAW' || u === 'BFILE') {
    return PythonTypes.byte
  }
  if (u === 'JSON') {
    return PythonTypes.json
  }
  return PythonTypes.string
}

export function pythonToOracle(column: Column): string {
  const ptype = column.pythonType
  if (ptype === null) {
    throw new Error(`Column ${column.name} is missing 'pythonType'.`)
  }

  if (ptype === PythonTypes.string) {
    const length = column.maxLength
    if (length === null || length > 4000) return 'CLOB'
    return `VARCHAR2(${length} CHAR)`
  }
  if (ptype === PythonTypes.integer) {
    return 'NUMBER'
  }
  if (ptype === PythonTypes.float) {
    const { precision, scale } = column
    if (precision !== null && scale !== null) return `NUMBER(${precision}, ${scale})`
    return 'NUMBER'
  }
  if (ptype === PythonTypes.boolean) {
    return 'VARCHAR2(1 CHAR)'
  }
  if (ptype === PythonTypes.datetime) {
    return column.timezone ? 'TIMESTAMP WITH TIME ZONE' : 'TIMESTAMP'
  }
  if (ptype === PythonTypes.date) {
    return 'DATE'
  }
  if (ptype === PythonTypes.time) {
    return 'VARCHAR2(15 CHAR)'
  }
  if (ptype === PythonTypes.byte) {
    return 'BLOB'
  }
  if (ptype === PythonTypes.json) {
    return 'JSON'
  }
  return 'VARCHAR2(255 CHAR)'
}

function oracleColumnInitFromColumn(col: Column): OracleColumnInit {
  return {
    name: col.name,
    alias: col.alias,
    rawType: col.rawType,
    pythonType: col.pythonType,
    isPrimaryKey: col.isPrimaryKey,
    isUnique: col.isUnique,
    isNullable: col.isNullable,
    isReadOnly: col.isReadOnly,
    isCompoundKey: col.isCompoundKey,
    isForeignKey: col.isForeignKey,
    foreignKeyMapping: { ...col.foreignKeyMapping },
    isForeignKeyEnforced: col.isForeignKeyEnforced,
    maxLength: col.maxLength,
    precision: col.precision,
    scale: col.scale,
    serializedNullValue: col.serializedNullValue,
    defaultValue: col.defaultValue,
    enumValues: [...col.enumValues],
    timezone: col.timezone,
    properties: { ...col.properties },
    ordinalPosition: col.ordinalPosition,
    isComputed: col.isComputed,
    formula: col.formula,
    isDeprecated: col.isDeprecated,
    isHidden: col.isHidden,
    isIndexed: col.isIndexed,
    description: col.description,
  }
}

export function toOracleTable(
  table: Table | OracleTable,
  enforceConstraints = true,
): OracleTable {
  if (!(table instanceof OracleTable)) {
    const cols: OracleColumn[] = []
    for (const col of table.columns) {
      const oraRaw =
        col.pythonType !== null ? pythonToOracle(col).split('(')[0].trim() : col.rawType
      const init = oracleColumnInitFromColumn(col)
      init.rawType = oraRaw
      init.enforceConstraints = enforceConstraints
      cols.push(new OracleColumn(init))
    }

    return new OracleTable({
      name: table.name,
      system: table.system,
      environment: table.environment,
      alias: table.alias,
      namespace: table.namespace,
      prefix: table.prefix,
      columns: cols,
      properties: { ...table.properties },
    })
  }

  // Already an OracleTable: apply the enforcement policy to its columns too.
  for (const col of table.columns) {
    col.enforceConstraints = enforceConstraints
  }
  return table
}

export function oracleBoolToPython(value: string | number | null = null): boolean | null {
  if (value === null || value === undefined) return null
  return String(value).trim().toUpperCase() === 'Y'
}

export function pythonBoolToOracle(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value ? 'Y' : 'N'
}

export function toNumberLike(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  const cleaned = String(value).replace(COMMA_RE, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (Number.isNaN(n)) return null
  // Preserve precision for integers beyond the JS safe range by binding as text.
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return cleaned
  return n
}

export function toDate(value: unknown): Date | string | null {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const stripped = value.trim()
    if (!stripped) return null
    const m = stripped.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) {
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    }
    return stripped
  }
  return value as Date | string | null
}

export function toDatetime(value: unknown): Date | string | null {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const stripped = value.trim()
    if (!stripped) return null
    const parsed = new Date(stripped)
    if (!Number.isNaN(parsed.getTime())) return parsed
    return stripped
  }
  return value as Date | string | null
}

export function normalizeCell(
  rawType: string,
  raw: unknown,
  pythonType: PythonTypes | null = null,
): unknown {
  if (raw === null || raw === undefined) return null

  if (typeof raw === 'boolean' || pythonType === PythonTypes.boolean) {
    return pythonBoolToOracle(raw)
  }

  // node-oracledb binds JS Date directly to DATE/TIMESTAMP columns.
  if (raw instanceof Date) {
    return raw
  }

  let value: unknown
  if (typeof raw === 'number' || typeof raw === 'bigint') {
    value = raw
  } else {
    const stripped = String(raw).replace(NULL_BYTE_RE, '')
    if (stripped.trim() === '') return null
    value = stripped
  }

  const u = String(rawType).toUpperCase()
  if (u === 'NUMBER') return toNumberLike(value)
  if (u === 'DATE') return toDate(value)
  if (u.includes('TIMESTAMP')) return toDatetime(value)
  if (u === 'CLOB' || u === 'BLOB') return value
  return String(value).trim()
}
