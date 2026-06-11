/**
 * OracleModels.ts
 *
 * Oracle-specific column/table models and the catalog SQL, ported from
 * src/oracle/OracleModels.py. OracleColumn/OracleTable carry the extra metadata
 * and SQL-generation methods needed to translate the system-agnostic models into
 * Oracle DDL/DML.
 */
import oracledb from 'oracledb'

import { Column, type ColumnInit, Table, type TableInit, PythonTypes } from '../models.js'

export const NULL_BYTE_RE = /\x00/g
export const COMMA_RE = /,/g
export const DATE_FMT_ISO = /^\d{4}-\d{2}-\d{2}/
export const TZ_OFFSET_RE = /[+-]\d{2}:\d{2}$/

export const ORACLE_MAX_VARCHAR2_CHAR = 4000
export const varchar2GrowthBuffer = 50

export const ORACLE_RESERVED: ReadonlySet<string> = new Set([
  'ACCESS', 'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'AUDIT',
  'BETWEEN', 'BY', 'CHAR', 'CHECK', 'CLUSTER', 'COLUMN', 'COMMENT',
  'COMPRESS', 'CONNECT', 'COUNT', 'CREATE', 'CURRENT', 'DATE', 'DECIMAL',
  'DEFAULT', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'EXCLUSIVE',
  'EXISTS', 'FILE', 'FLOAT', 'FOR', 'FROM', 'GRANT', 'GROUP', 'HAVING',
  'IDENTIFIED', 'IMMEDIATE', 'IN', 'INCREMENT', 'INDEX', 'INITIAL',
  'INSERT', 'INTEGER', 'INTERSECT', 'INTO', 'IS', 'LEVEL', 'LIKE',
  'LOCK', 'LONG', 'MAXEXTENTS', 'MINUS', 'MLSLABEL', 'MODE', 'MODIFY',
  'NOAUDIT', 'NOCOMPRESS', 'NOT', 'NOWAIT', 'NULL', 'NUMBER', 'OF',
  'OFFLINE', 'ON', 'ONLINE', 'OPTION', 'OR', 'ORDER', 'PCTFREE', 'PRIOR',
  'PRIVILEGES', 'PUBLIC', 'RAW', 'RENAME', 'RESOURCE', 'REVOKE', 'ROW',
  'ROWID', 'ROWNUM', 'ROWS', 'SELECT', 'SESSION', 'SET', 'SHARE', 'SIZE',
  'SMALLINT', 'START', 'SUCCESSFUL', 'SYNONYM', 'SYSDATE', 'TABLE',
  'THEN', 'TO', 'TRIGGER', 'UID', 'UNION', 'UNIQUE', 'UPDATE', 'USER',
  'VALIDATE', 'VALUES', 'VARCHAR', 'VARCHAR2', 'VIEW', 'WHENEVER',
  'WHERE', 'WITH', 'CROSS', 'CUBE', 'FETCH', 'FULL', 'INNER', 'JOIN',
  'LEFT', 'MERGE', 'NATURAL', 'OFFSET', 'OUTER', 'RIGHT', 'ROLLUP',
  'USING', 'WHEN',
  'CASE',
])

/**
 * Canonicalize an identifier to an Oracle UPPER_SNAKE form. Idempotent on its
 * own output, which is what makes cross-system column matching stable.
 */
export function toOracleSnake(
  value: string,
  maxLen = 128,
  reserved: ReadonlySet<string> = ORACLE_RESERVED,
  forcedPrefix: string | null = null,
  optionalSuffix = 'COL',
): string {
  let s = String(value).trim()
  if (!s) return optionalSuffix

  s = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  s = s.replace(/([A-Za-z])([0-9])/g, '$1_$2')
  s = s.replace(/([0-9])([A-Za-z])/g, '$1_$2')
  s = s.replace(/[^A-Za-z0-9_]+/g, '_')
  s = s.replace(/^_+|_+$/g, '').toUpperCase()

  if (!s) return optionalSuffix

  if (/^[0-9]/.test(s)) {
    s = forcedPrefix ? `${forcedPrefix}_${s}` : `C_${s}`
  }

  if (reserved.has(s)) {
    s = forcedPrefix ? `${forcedPrefix}_${s}` : `${s}_${optionalSuffix}`
  }

  if (s.length > maxLen) {
    const prefix = forcedPrefix || ''
    if (forcedPrefix && s.startsWith(prefix)) {
      s = s.slice(prefix.length, maxLen).replace(/_+$/g, '')
    } else if (s.endsWith(`_${optionalSuffix}`)) {
      const base = s.slice(0, maxLen - optionalSuffix.length - 1).replace(/_+$/g, '')
      s = `${base}_${optionalSuffix}`
    } else {
      s = s.slice(0, maxLen).replace(/_+$/g, '')
    }
  }

  return s || optionalSuffix
}

export interface OracleColumnInit extends ColumnInit {
  charLength?: number | null
  charUsed?: string | null
  isNew?: boolean
  enforceConstraints?: boolean
  oracleNameOverride?: string | null
}

export class OracleColumn extends Column {
  charLength: number | null
  charUsed: string | null
  isNew: boolean
  // When false, NOT NULL is recorded as DISABLE NOVALIDATE: documented in the
  // catalog but not enforced on DML. Used for Salesforce sources, whose
  // describe nillable=false metadata does not reflect the real data.
  enforceConstraints: boolean
  oracleNameOverride: string | null

  constructor(init: OracleColumnInit) {
    super({ serializedNullValue: 'NULL', ...init })
    this.charLength = init.charLength ?? null
    this.charUsed = init.charUsed ?? null
    this.isNew = init.isNew ?? false
    this.enforceConstraints = init.enforceConstraints ?? true
    this.oracleNameOverride = init.oracleNameOverride ?? null
  }

  get oracleName(): string {
    if (this.oracleNameOverride) return this.oracleNameOverride
    return toOracleSnake(this.name)
  }

  get bindName(): string {
    return this.oracleName || this.name
  }

  get effectiveMaxVarchar2(): number {
    const observed = Math.max(this.charLength ?? 0, this.maxLength ?? 0)
    if (observed > ORACLE_MAX_VARCHAR2_CHAR) {
      throw new Error(
        `observed_char_len ${observed} exceeds Oracle max ${ORACLE_MAX_VARCHAR2_CHAR}`,
      )
    }
    const buffered = observed + varchar2GrowthBuffer
    return Math.min(buffered, ORACLE_MAX_VARCHAR2_CHAR)
  }

  columnDefinition(): string {
    const rt = this.rawType
    let typeClause: string

    if (rt === 'VARCHAR2') {
      typeClause =
        this.pythonType === PythonTypes.boolean
          ? 'VARCHAR2(1 CHAR)'
          : `VARCHAR2(${this.effectiveMaxVarchar2} CHAR)`
    } else if (rt === 'NUMBER') {
      typeClause = 'NUMBER'
    } else if (rt === 'DATE') {
      typeClause = 'DATE'
    } else if (String(rt).includes('TIMESTAMP')) {
      typeClause = 'TIMESTAMP'
    } else if (rt === 'CLOB') {
      typeClause = 'CLOB'
    } else if (rt === 'BLOB') {
      typeClause = 'BLOB'
    } else if (rt === 'JSON') {
      typeClause = 'JSON'
    } else {
      throw new Error(`Unrecognized rawType '${rt}' on column '${this.bindName}'`)
    }

    let nullClause: string
    if (this.isNullable) {
      nullClause = ' NULL'
    } else if (this.enforceConstraints) {
      nullClause = ' NOT NULL'
    } else {
      // Record the constraint for documentation/optimizer metadata, but do not
      // enforce it: the source's nullability claim isn't trustworthy.
      nullClause = ' NOT NULL DISABLE NOVALIDATE'
    }
    return `${this.bindName} ${typeClause}${nullClause}`
  }

  /** node-oracledb executeMany bindDef for this column, or null if untyped. */
  get oracledbInputSize(): { type: unknown; maxSize?: number } | null {
    const rt = this.rawType ? this.rawType.toUpperCase() : null
    if (rt === null) return null

    if (rt === 'VARCHAR2' || rt === 'NVARCHAR2' || rt === 'CHAR') {
      return { type: oracledb.DB_TYPE_VARCHAR, maxSize: this.charLength ?? this.maxLength ?? 4000 }
    }
    if (rt === 'NUMBER' || rt === 'FLOAT' || rt === 'BINARY_FLOAT' || rt === 'BINARY_DOUBLE') {
      return { type: oracledb.DB_TYPE_NUMBER }
    }
    if (rt === 'DATE') {
      return { type: oracledb.DB_TYPE_DATE }
    }
    if (rt.startsWith('TIMESTAMP')) {
      return { type: oracledb.DB_TYPE_TIMESTAMP_TZ ?? oracledb.DB_TYPE_TIMESTAMP }
    }
    if (rt === 'CLOB' || rt === 'NCLOB') {
      return { type: oracledb.DB_TYPE_CLOB }
    }
    if (rt === 'BLOB' || rt === 'BFILE') {
      return { type: oracledb.DB_TYPE_BLOB }
    }
    if (rt === 'RAW' || rt === 'LONG RAW') {
      return { type: oracledb.DB_TYPE_RAW }
    }
    if (rt === 'JSON') {
      return { type: oracledb.DB_TYPE_JSON ?? oracledb.DB_TYPE_CLOB }
    }
    return null
  }
}

export type OracleTableInit = TableInit<OracleColumn>

export class OracleTable extends Table<OracleColumn> {
  _fetchedColumns: Record<string, unknown>[] | null = null
  _activePlanCache: unknown[] | null = null

  get qualifiedName(): string {
    return this.namespace ? `${this.namespace}.${this.name}` : this.name
  }

  override get columnMap(): Record<string, OracleColumn> {
    return Object.fromEntries(this.columns.map((c) => [c.name, c]))
  }

  override get primaryKeyColumns(): OracleColumn[] {
    return this.columns.filter((c) => c.isPrimaryKey)
  }

  /** bindDefs mapping for connection.executeMany(). */
  columnInputSizes(): Record<string, { type: unknown; maxSize?: number }> {
    const sizes: Record<string, { type: unknown; maxSize?: number }> = {}
    for (const col of this.columns) {
      if (!col.rawType) continue
      const size = col.oracledbInputSize
      if (size) sizes[col.bindName] = size
    }
    return sizes
  }

  insertSql(): string {
    const cols: string[] = []
    const binds: string[] = []
    for (const col of this.columns) {
      const bn = col.bindName
      cols.push(bn)
      binds.push(bn.startsWith(':') ? bn : `:${bn}`)
    }
    return `INSERT INTO ${this.qualifiedName} (${cols.join(', ')}) VALUES (${binds.join(', ')})`
  }

  updateSql(): string {
    const pkNames = this.columns.filter((c) => c.isPrimaryKey).map((c) => c.bindName)
    const dataNames = this.columns.filter((c) => !c.isPrimaryKey).map((c) => c.bindName)

    const updateAssigns = dataNames.map((col) => `${col} = :${col}`).join(', ')
    const whereConds = pkNames.map((col) => `${col} = :${col}`).join(' AND ')

    return `UPDATE ${this.qualifiedName} SET ${updateAssigns} WHERE ${whereConds}`
  }

  mergeSql(): string {
    const pkNames = this.columns.filter((c) => c.isPrimaryKey).map((c) => c.bindName)
    const dataNames = this.columns.filter((c) => !c.isPrimaryKey).map((c) => c.bindName)
    const allCols = [...pkNames, ...dataNames]

    if (pkNames.length === 0) {
      throw new Error(
        `Cannot build an upsert MERGE for '${this.qualifiedName}': no primary-key ` +
          `column is identified, so there is no key to match on. Upsert requires a key ` +
          `(for Salesforce sources this is the Id/ID column).`,
      )
    }

    const matchConds = pkNames.map((col) => `target.${col} = source.${col}`).join(' AND ')
    const updateAssigns = dataNames.map((col) => `target.${col} = source.${col}`).join(', ')
    const insertCols = allCols.join(', ')
    const sourceCols = allCols.map((col) => `source.${col}`).join(', ')
    const sourceSelects = allCols.map((col) => `:${col} AS ${col}`).join(', ')

    return [
      `MERGE INTO ${this.qualifiedName} target`,
      `USING (SELECT ${sourceSelects} FROM dual) source`,
      `ON (${matchConds})`,
      `WHEN MATCHED THEN`,
      `    UPDATE SET ${updateAssigns}`,
      `WHEN NOT MATCHED THEN`,
      `    INSERT (${insertCols})`,
      `    VALUES (${sourceCols})`,
    ].join('\n')
  }

  clearCaches(): void {
    this._fetchedColumns = null
    this._activePlanCache = null
  }
}

export const SQL_TABLE_COLUMNS = `
SELECT
    column_name,
    column_id,
    data_type,
    data_length,
    char_length,
    data_precision,
    data_scale,
    nullable,
    data_default
FROM all_tab_columns
WHERE owner = :owner
  AND table_name = :table_name
ORDER BY column_id
`

export const SQL_TABLE_PKS = `
SELECT
    col.column_name
FROM all_constraints con
JOIN all_cons_columns col
    ON con.constraint_name = col.constraint_name
    AND con.owner = col.owner
WHERE con.constraint_type = 'P'
  AND con.owner = :owner
  AND col.table_name = :table_name
`

export const SQL_TABLE_FKS = `
SELECT
    fk_col.column_name AS column_name,
    pk_col.table_name AS ref_table,
    pk_col.column_name AS ref_column
FROM all_constraints fk_con
JOIN all_cons_columns fk_col
    ON fk_con.constraint_name = fk_col.constraint_name
    AND fk_con.owner = fk_col.owner
JOIN all_constraints pk_con
    ON fk_con.r_constraint_name = pk_con.constraint_name
    AND fk_con.owner = pk_con.owner
JOIN all_cons_columns pk_col
    ON pk_con.constraint_name = pk_col.constraint_name
    AND pk_con.owner = pk_col.owner
    AND fk_col.position = pk_col.position
WHERE fk_con.constraint_type = 'R'
  AND fk_con.owner = :owner
  AND fk_col.table_name = :table_name
`

export const SQL_TABLE_INDEXES = `
SELECT
    ic.column_name,
    i.uniqueness
FROM all_indexes i
JOIN all_ind_columns ic
    ON i.index_name = ic.index_name
    AND i.owner = ic.index_owner
WHERE i.owner = :owner
  AND i.table_name = :table_name
  AND i.index_type != 'LOB'
  AND i.generated = 'N'
`
