/**
 * Oracle.ts
 *
 * DataSource implementation for Oracle, ported from src/oracle/Oracle.py. Adapts
 * the system-agnostic models to Oracle DDL/DML: schema/table describe from the
 * catalog, schema drift sync (CREATE/ALTER), and a batched load path that widens
 * VARCHAR2 columns on ORA-12899 and retries the offending rows.
 */
import {
  type DataSource,
  type LoadOptions,
  type QueryOptions,
  type Row,
  PythonTypes,
  Records,
  Schema,
  System,
  Table,
  toSystem,
} from '../models.js'
import { OracleClient } from './OracleClient.js'
import { oracleToPython, normalizeCell, toOracleTable } from './OracleTypeMap.js'
import {
  OracleColumn,
  OracleTable,
  toOracleSnake,
  ORACLE_MAX_VARCHAR2_CHAR,
  varchar2GrowthBuffer,
  SQL_TABLE_PKS,
  SQL_TABLE_FKS,
  SQL_TABLE_INDEXES,
  SQL_TABLE_COLUMNS,
} from './OracleModels.js'

/** Strip an inline precision (e.g. TIMESTAMP(6) -> TIMESTAMP) for drift compare. */
function normalizeOraType(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\(\s*\d+\s*\)/g, '')
    .trim()
    .toUpperCase()
}

// ORA-12899: value too large for column "S"."T"."COL" (actual: 113, maximum: 90)
const ORA_12899_RE =
  /column\s+(?:"[^"]+"\.)*"(?<col>[^"]+)"\s*\(actual:\s*(?<actual>\d+),\s*maximum:\s*(?<max>\d+)\)/

function parseValueTooLarge(message: string): { col: string; actual: number } | null {
  const m = ORA_12899_RE.exec(message || '')
  if (!m || !m.groups) return null
  return { col: m.groups.col, actual: Number(m.groups.actual) }
}

export class Oracle implements DataSource {
  client: OracleClient
  environment: string | null
  namespace: string | null

  constructor(environment: string, namespace: string | null = null) {
    this.environment = environment.toUpperCase()
    this.client = OracleClient.clientConstructor(this.environment)
    this.namespace = namespace ? namespace.toUpperCase() : this.client.user.toUpperCase()
  }

  schema(namespace: string | null = null): string {
    return (
      namespace ||
      this.namespace ||
      this.client.currentSchema ||
      this.client.user.toUpperCase() ||
      ''
    ).toUpperCase()
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.connect()
      return this.client.isHealthy()
    } catch (e) {
      console.error('Oracle health check failed for %s: %s', this.environment, e)
      return false
    }
  }

  async describeSchema(namespace: string | null = null): Promise<Schema> {
    const sql = 'SELECT DISTINCT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :schema'
    const schema = this.schema(namespace)

    const tableNames = [
      ...new Set((await this.client.query(sql, { schema })).map((r) => String(r.TABLE_NAME))),
    ].sort()

    const tables: Table[] = []
    for (const tbl of tableNames) {
      const t = new Table({ name: tbl, system: System.oracle, namespace: schema })
      tables.push(await this.describeTable(t))
    }

    return new Schema({ namespace: schema, system: System.oracle, tables })
  }

  async describeTable(table: Table): Promise<Table> {
    const oraTable = toOracleTable(table)
    const binds = {
      owner: this.schema(oraTable.namespace),
      table_name: oraTable.name.toUpperCase(),
    }

    const colFilter: Set<string> | null = oraTable.columns.length
      ? new Set(oraTable.columns.map((c) => c.oracleName || toOracleSnake(c.name)))
      : null

    const pkSet = new Set(
      (await this.client.query(SQL_TABLE_PKS, binds)).map((r) => String(r.COLUMN_NAME)),
    )

    const fkMap: Record<string, Record<string, string>> = {}
    for (const r of await this.client.query(SQL_TABLE_FKS, binds)) {
      const colName = String(r.COLUMN_NAME)
      ;(fkMap[colName] ??= {})[String(r.REF_TABLE)] = String(r.REF_COLUMN)
    }

    const idxMap: Record<string, boolean> = {}
    for (const r of await this.client.query(SQL_TABLE_INDEXES, binds)) {
      const colName = String(r.COLUMN_NAME)
      idxMap[colName] = (idxMap[colName] ?? false) || r.UNIQUENESS === 'UNIQUE'
    }

    const colRows = (await this.client.query(SQL_TABLE_COLUMNS, binds)).filter(
      (r) => colFilter === null || colFilter.has(String(r.COLUMN_NAME)),
    )

    const columns: OracleColumn[] = []
    for (const row of colRows) {
      const colName = String(row.COLUMN_NAME)
      const raw = String(row.DATA_TYPE ?? '')
      const scale = row.DATA_SCALE !== null && row.DATA_SCALE !== undefined ? Number(row.DATA_SCALE) : null
      const prec =
        row.DATA_PRECISION !== null && row.DATA_PRECISION !== undefined
          ? Number(row.DATA_PRECISION)
          : null
      const length =
        raw === 'CLOB' || raw === 'NCLOB' ? null : (row.CHAR_LENGTH ?? row.DATA_LENGTH)
      const maxLength = length !== null && length !== undefined ? Number(length) : null

      columns.push(
        new OracleColumn({
          name: colName,
          rawType: raw,
          pythonType: oracleToPython(raw, scale, maxLength),
          ordinalPosition: Number(row.COLUMN_ID ?? 0),
          precision: prec,
          scale,
          maxLength,
          isNullable: String(row.NULLABLE ?? 'Y') === 'Y',
          defaultValue: row.DATA_DEFAULT,
          isPrimaryKey: pkSet.has(colName),
          isForeignKey: colName in fkMap,
          foreignKeyMapping: fkMap[colName] ?? {},
          isIndexed: colName in idxMap,
          isUnique: idxMap[colName] ?? false,
          serializedNullValue: 'NULL',
        }),
      )
    }

    return new Table({
      name: table.name,
      system: System.oracle,
      environment: table.environment,
      alias: table.alias,
      namespace: this.schema(table.namespace),
      prefix: table.prefix,
      columns,
    })
  }

  async query(statement: string, opts: QueryOptions = {}): Promise<Records> {
    return new Records({ data: this.client.lazyQuery(statement, opts.binds ?? {}) })
  }

  async getRecords(table: Table, opts: QueryOptions = {}): Promise<Records> {
    try {
      const colStr = table.columns.length ? table.columns.map((c) => c.name).join(', ') : '*'
      let sql = `SELECT ${colStr} FROM ${this.schema(table.namespace)}.${table.name}`

      const binds = opts.binds ?? {}
      const conditions = Object.keys(binds).map((k) => `${k} = :${k}`)
      if (conditions.length) {
        sql = `${sql} WHERE ${conditions.join(' AND ')}`
      }

      return new Records({ data: this.client.lazyQuery(sql, binds), columns: table.columns })
    } catch (e) {
      console.error(`Error in getRecords: ${e}`)
      return new Records({ code: 500, message: String(e) })
    }
  }

  async loadRecords(
    action: string,
    table: Table | OracleTable,
    records: Records,
    opts: LoadOptions = {},
  ): Promise<void> {
    const batchSize = opts.batchSize ?? 50_000
    const oracleTable = toOracleTable(table)
    const mutated = this.mutateRecords(oracleTable, records)

    let statement: string
    if (action === 'insert') {
      statement = oracleTable.insertSql()
    } else if (action === 'upsert') {
      statement = oracleTable.mergeSql()
    } else if (action === 'update') {
      statement = oracleTable.updateSql()
    } else if (action === 'reset') {
      await this.client.execute(`TRUNCATE TABLE ${oracleTable.qualifiedName} CASCADE`)
      statement = oracleTable.insertSql()
    } else {
      throw new Error(`class Oracle, function: loadRecords, action: Unknown value entered: ${action} `)
    }

    try {
      const it = mutated.data[Symbol.asyncIterator]()
      for (;;) {
        const chunk: Row[] = []
        while (chunk.length < batchSize) {
          const next = await it.next()
          if (next.done) break
          chunk.push(next.value)
        }
        if (chunk.length === 0) break
        await this._loadChunk(oracleTable, statement, chunk)
      }
      await this.client.commit()
    } catch (e) {
      await this.client.rollback()
      throw e
    }
  }

  /**
   * Execute one batch, widening VARCHAR2 columns that overflow and retrying only
   * the failed rows. Salesforce's describe under-reports field lengths, so real
   * data can exceed the column size we created.
   */
  private async _loadChunk(oracleTable: OracleTable, statement: string, chunk: Row[]): Promise<void> {
    let pending = chunk
    // Bounded: every pass either widens at least one column or raises.
    for (let pass = 0; pass < oracleTable.columns.length + 2; pass++) {
      const bindDefs = oracleTable.columnInputSizes()
      const errors = await this.client.executeMany(statement, pending, bindDefs)
      if (errors.length === 0) return

      const widen: Record<string, number> = {}
      const retryRows: Row[] = []
      for (const err of errors) {
        const parsed = parseValueTooLarge(err.message)
        if (err.code === 12899 && parsed !== null) {
          widen[parsed.col] = Math.max(widen[parsed.col] ?? 0, parsed.actual)
          retryRows.push(pending[err.offset])
        } else {
          // Non-widenable error: surface every error in the batch.
          throw new Error(errors.map((e) => `\n${e.message}`).join(''))
        }
      }

      await this._widenColumns(oracleTable, widen)
      pending = retryRows
    }

    throw new Error(
      `loadRecords: column widening for '${oracleTable.qualifiedName}' ` +
        `did not converge after ${oracleTable.columns.length + 2} passes.`,
    )
  }

  /** Grow VARCHAR2 columns to fit oversized data (capped at the Oracle max). */
  private async _widenColumns(
    oracleTable: OracleTable,
    widen: Record<string, number>,
  ): Promise<void> {
    const colByName: Record<string, OracleColumn> = Object.fromEntries(
      oracleTable.columns.map((c) => [c.oracleName, c]),
    )

    // ALTER is DDL (implicit commit) and needs the row locks released first.
    await this.client.commit()
    for (const [colName, required] of Object.entries(widen)) {
      const col = colByName[colName]
      if (!col || col.rawType !== 'VARCHAR2') {
        throw new Error(
          `Cannot widen column '${oracleTable.qualifiedName}.${colName}': ` +
            `not a VARCHAR2 column in the table definition.`,
        )
      }
      if (required > ORACLE_MAX_VARCHAR2_CHAR) {
        throw new Error(
          `Column '${oracleTable.qualifiedName}.${colName}' needs ${required} chars, ` +
            `exceeding the VARCHAR2 maximum of ${ORACLE_MAX_VARCHAR2_CHAR}.`,
        )
      }

      const newSize = Math.min(required + varchar2GrowthBuffer, ORACLE_MAX_VARCHAR2_CHAR)
      const alterSql = `ALTER TABLE ${oracleTable.qualifiedName} MODIFY (${colName} VARCHAR2(${newSize} CHAR))`
      console.info(
        "Widening '%s.%s' to VARCHAR2(%d CHAR) to fit oversized source data (actual %d).",
        oracleTable.qualifiedName,
        colName,
        newSize,
        required,
      )
      await this.client.execute(alterSql)
      col.charLength = newSize
      col.maxLength = newSize
    }
    // Bind sizes are recomputed per executeMany call, so no refresh needed here.
  }

  mutateRecords(table: OracleTable, records: Records): Records {
    const rawData = records.data
    const cols = records.columns

    // Key by canonical Oracle column name so source keys in any casing convention
    // (SF 'LastName', Oracle 'LAST_NAME') resolve correctly.
    const schemaMap: Record<string, OracleColumn> = Object.fromEntries(
      table.columns.map((col) => [col.oracleName, col]),
    )

    async function* cleaningGenerator(): AsyncGenerator<Row> {
      for await (const row of rawData) {
        const cleanedRow: Row = {}
        for (const [k, v] of Object.entries(row)) {
          const colSchema = schemaMap[toOracleSnake(k)]
          if (!colSchema) {
            throw new Error(
              `Pipeline Definition Error: Field '${k}' was received from the source dataset, ` +
                `but it does not exist in your Table configuration for '${table.name}'.`,
            )
          }
          cleanedRow[colSchema.oracleName] = normalizeCell(
            String(colSchema.rawType),
            v,
            colSchema.pythonType,
          )
        }
        yield cleanedRow
      }
    }

    return new Records({ data: cleaningGenerator(), columns: cols, code: 200, message: 'ok' })
  }

  async mutateTable(table: Table | OracleTable, sourceSystem: System | null = null): Promise<Table> {
    // Salesforce describe nullability/constraints don't reflect real data, so
    // constraints sourced from SF are recorded but not enforced.
    const enforceConstraints = sourceSystem === null || toSystem(sourceSystem) !== System.salesforce

    const oraTable = toOracleTable(table, enforceConstraints)
    oraTable.namespace = this.schema(table.namespace)

    let fetched = await this.client.allTabColumns(String(oraTable.namespace), oraTable.name)

    if (fetched.length === 0) {
      // Table is missing: create it, then synthesize the catalog rows.
      await this.mutateCreateTable(oraTable)
      oraTable.clearCaches()
      fetched = oraTable.columns.map((col) => ({
        COLUMN_NAME: col.oracleName,
        DATA_TYPE: col.rawType,
        CHAR_USED: col.charUsed || 'C',
        NULLABLE: col.isNullable ? 'Y' : 'N',
        CHAR_LENGTH: col.charLength || col.maxLength || 255,
        DATA_LENGTH: col.maxLength || 255,
        DATA_PRECISION: col.precision,
        DATA_SCALE: col.scale,
      }))
    }

    const maxPasses = 2 * oraTable.columns.length + 2
    let converged = false
    for (let pass = 0; pass < maxPasses; pass++) {
      const dbColMap: Record<string, Row> = Object.fromEntries(
        fetched.map((row) => [String(row.COLUMN_NAME), row]),
      )
      const newCols: OracleColumn[] = []
      let columnMutated = false

      for (const col of oraTable.columns) {
        const row = dbColMap[col.oracleName]

        if (!row) {
          col.isNew = true
          newCols.push(col)
          continue
        }

        const dbRawType = String(row.DATA_TYPE ?? '').toUpperCase()
        const dbNullable = String(row.NULLABLE ?? 'Y') === 'Y'
        const alterClauses: string[] = []

        // A. Datatype mismatches (e.g. promoting VARCHAR2 sizes dynamically).
        if (col.rawType === 'VARCHAR2' && dbRawType === 'VARCHAR2') {
          const dbLength = Number(row.CHAR_LENGTH || row.DATA_LENGTH || 0)
          // Booleans are fixed at VARCHAR2(1 CHAR); mirror columnDefinition().
          const targetLength = col.pythonType === PythonTypes.boolean ? 1 : col.effectiveMaxVarchar2
          if (targetLength > dbLength) {
            alterClauses.push(`MODIFY ${col.oracleName} VARCHAR2(${targetLength} CHAR)`)
          }
        } else if (col.rawType && col.rawType.toUpperCase() !== normalizeOraType(dbRawType)) {
          const definitionClause = col.columnDefinition()
          const typePart = definitionClause
            .replace(col.bindName, '')
            .replace('NOT NULL', '')
            .replace('NULL', '')
            .trim()
          alterClauses.push(`MODIFY ${col.oracleName} ${typePart}`)
        }

        // B. Nullability alterations.
        if (col.isNullable !== dbNullable) {
          if (!col.isNullable && !enforceConstraints) {
            // Soft (DISABLE NOVALIDATE) NOT NULL reports NULLABLE='Y'; expected.
          } else {
            const nullToggle = col.isNullable ? 'NULL' : 'NOT NULL'
            alterClauses.push(`MODIFY ${col.oracleName} ${nullToggle}`)
          }
        }

        // C. Execute ALTER MODIFY immediately on drift.
        if (alterClauses.length) {
          for (const clause of alterClauses) {
            const alterSql = `ALTER TABLE ${oraTable.qualifiedName} ${clause}`
            console.info(`Syncing schema drift on '${oraTable.qualifiedName}': ${alterSql}`)
            await this.client.execute(alterSql)
          }
          columnMutated = true
        }
      }

      // D. Column appends (ALTER TABLE ADD).
      if (newCols.length) {
        await this.mutateAddColumns(oraTable, newCols)
        oraTable.clearCaches()
        fetched = await this.client.allTabColumns(String(oraTable.namespace), oraTable.name)
        continue
      }

      // E. If alterations occurred, re-fetch and re-evaluate.
      if (columnMutated) {
        oraTable.clearCaches()
        fetched = await this.client.allTabColumns(String(oraTable.namespace), oraTable.name)
        continue
      }

      converged = true
      break
    }

    if (!converged) {
      throw new Error(
        `Schema drift sync for '${oraTable.qualifiedName}' failed to converge ` +
          `after ${maxPasses} passes; a MODIFY/ADD clause is not resolving.`,
      )
    }

    // Maintain abstract contract: re-describe for a clean generic Table exit.
    const described = await this.describeTable(
      new OracleTable({ name: oraTable.name, system: System.oracle, namespace: oraTable.namespace }),
    )

    // The catalog carries no PK/unique constraints (we create columns only), so
    // carry the logical key over from the source-derived schema by column name,
    // otherwise mergeSql() has no ON-clause keys and upserts fail with ORA-00936.
    const sourceKey: Record<string, OracleColumn> = Object.fromEntries(
      oraTable.columns.map((c) => [c.oracleName, c]),
    )
    for (const col of described.columns as OracleColumn[]) {
      const src = sourceKey[col.oracleName]
      if (src) {
        col.isPrimaryKey = col.isPrimaryKey || src.isPrimaryKey
        col.isUnique = col.isUnique || src.isUnique
      }
    }
    return described
  }

  async mutateCreateTable(table: OracleTable): Promise<void> {
    const colDefs: string[] = []
    for (const col of table.columns) {
      col.isNew = true
      colDefs.push(col.columnDefinition())
    }
    const sql = `CREATE TABLE ${table.qualifiedName} (${colDefs.join(', ')})`
    console.debug(`Executing CREATE TABLE for ${table.name} in ${this.schema()}\nstatement = ${sql}`)
    await this.client.execute(sql)
    await this.client.commit()
  }

  async mutateAddColumns(table: OracleTable, newColumns: OracleColumn[]): Promise<void> {
    const colDefs = newColumns.map((col) => col.columnDefinition()).join(', ')
    const sql = `ALTER TABLE ${table.qualifiedName} ADD (${colDefs})`
    await this.client.execute(sql)
  }
}
