/**
 * OracleClient.ts
 *
 * Thin wrapper around node-oracledb providing a simplified, stateful interface,
 * ported from src/oracle/OracleClient.py. It caches one connection on the
 * instance and reuses it across calls. Only the surface actually exercised by
 * the migration engine is ported (connect/health, query/stream/execute/
 * executeMany, catalog lookups) -- the long tail of oracledb passthrough
 * properties in the Python original is omitted as it has no Node equivalent.
 */
import oracledb, { type Connection, type BindParameters } from 'oracledb'

import type { Row } from '../models.js'

// Match charon's json_factory: CLOBs read as strings, rows keyed by column name.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
oracledb.fetchAsString = [oracledb.CLOB]
oracledb.fetchAsBuffer = [oracledb.BLOB]

export interface BatchError {
  offset: number
  code: number
  message: string
}

export class OracleClient {
  private _oracleUser: string
  private _oraclePass: string
  private _oracleHost: string
  private _oraclePort: number
  private _oracleService: string
  private _connection: Connection | null = null

  constructor(
    oracleUser = '',
    oraclePass = '',
    oracleHost = '',
    oraclePort: number | string = 1521,
    oracleService = '',
  ) {
    this._oracleUser = oracleUser
    this._oraclePass = oraclePass
    this._oracleHost = oracleHost
    this._oraclePort = Number(oraclePort)
    this._oracleService = oracleService

    if (!this._oraclePass) {
      throw new Error(`No Values detected:\n${this.toString()}`)
    }
  }

  toString(): string {
    return (
      `OracleClient(user=${JSON.stringify(this._oracleUser)}, ` +
      `host=${JSON.stringify(this._oracleHost)}, ` +
      `port=${this._oraclePort}, ` +
      `service=${JSON.stringify(this._oracleService)})`
    )
  }

  static clientConstructor(environment: string, prefix = 'ORACLE'): OracleClient {
    const E = environment.toUpperCase()
    const e = environment.toLowerCase()
    const get = (suffix: string) =>
      process.env[`${prefix}_${E}_${suffix}`] || process.env[`${prefix}_${e}_${suffix}`] || undefined

    const user = get('USER')
    const pwd = get('PASS')
    const host = get('HOST')
    const port = get('PORT') || '1521'
    const svc = get('SERVICE') || get('SID')

    if (!user || !pwd || !host || !svc) {
      throw new Error(`Missing Oracle env vars for '${environment}'`)
    }

    return new OracleClient(user, pwd, host, Number(port), svc)
  }

  private async _newConnect(): Promise<void> {
    this._connection = await oracledb.getConnection({
      user: this._oracleUser,
      password: this._oraclePass,
      connectString: `${this._oracleHost}:${this._oraclePort}/${this._oracleService}`,
    })
    // node-oracledb defaults oracledb.autoCommit to false; transactions are
    // committed explicitly by the load path.
  }

  async connect(): Promise<Connection> {
    if (this._connection !== null && this._connection.isHealthy()) {
      return this._connection
    }
    await this._newConnect()
    if (this._connection === null) {
      throw new Error(`Failed to establish Oracle connection: ${this.toString()}`)
    }
    return this._connection
  }

  isHealthy(): boolean {
    return this._connection !== null && this._connection.isHealthy()
  }

  async close(): Promise<void> {
    if (this._connection) {
      await this._connection.close()
      this._connection = null
    }
  }

  async commit(): Promise<void> {
    ;(await this.connect()).commit()
  }

  async rollback(): Promise<void> {
    ;(await this.connect()).rollback()
  }

  /** Eager query returning all rows as objects keyed by column name. */
  async query(statement: string, binds: Record<string, unknown> = {}): Promise<Row[]> {
    const conn = await this.connect()
    const result = await conn.execute<Row>(statement, binds as BindParameters, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    })
    return result.rows ?? []
  }

  /** Lazy query: stream rows one at a time as objects. */
  async *lazyQuery(
    statement: string,
    binds: Record<string, unknown> = {},
    batchSize = 10_000,
  ): AsyncGenerator<Row> {
    const conn = await this.connect()
    const stream = conn.queryStream<Row>(statement, binds as BindParameters, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      fetchArraySize: batchSize,
    })
    for await (const row of stream) {
      yield row
    }
  }

  /** Execute a DDL statement (CREATE, ALTER, DROP, TRUNCATE). */
  async execute(statement: string): Promise<void> {
    const conn = await this.connect()
    try {
      await conn.execute(statement)
    } catch (e) {
      console.error('Oracle DDL failed: %s | %s', statement, e)
      throw e
    }
  }

  /**
   * Batched executeMany with per-row error collection (node-oracledb
   * batchErrors). Returns the collected errors normalized to {offset, code,
   * message}; an empty array means full success.
   */
  async executeMany(
    sql: string,
    rows: Row[],
    bindDefs?: Record<string, { type: unknown; maxSize?: number }>,
  ): Promise<BatchError[]> {
    const conn = await this.connect()
    const options: Record<string, unknown> = { batchErrors: true, dmlRowCounts: true }
    if (bindDefs && Object.keys(bindDefs).length > 0) {
      options.bindDefs = bindDefs
    }
    const result = await conn.executeMany(sql, rows as BindParameters[], options)
    return (result.batchErrors ?? []).map((e) => ({
      offset: (e as { offset?: number }).offset ?? 0,
      code: (e as { errorNum?: number }).errorNum ?? 0,
      message: e.message,
    }))
  }

  async recordCount(table: string): Promise<number> {
    const rows = await this.query(`SELECT COUNT(*) AS CNT FROM ${table}`)
    return Number((rows[0] as { CNT: unknown }).CNT)
  }

  async allTabColumns(schema: string, table: string): Promise<Row[]> {
    const sql = `
      SELECT
        column_name,
        column_id,
        data_type,
        data_length,
        char_length,
        char_used,
        data_precision,
        data_scale,
        nullable,
        data_default,
        default_length
      FROM all_tab_columns
      WHERE owner = :schema
      AND table_name = :table_name
      ORDER BY column_id
    `
    return this.query(sql, { schema: schema.toUpperCase(), table_name: table.toUpperCase() })
  }

  get currentSchema(): string | null {
    return this._connection?.currentSchema || this._oracleUser.toUpperCase() || null
  }

  get user(): string {
    return this._oracleUser
  }

  get host(): string {
    return this._oracleHost
  }

  get port(): number {
    return this._oraclePort
  }

  get service(): string {
    return this._oracleService
  }
}
