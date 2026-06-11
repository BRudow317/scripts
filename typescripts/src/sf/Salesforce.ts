/**
 * Salesforce.ts
 *
 * DataSource implementation for Salesforce, ported from src/sf/Salesforce.py.
 * Reads route between the REST query API and Bulk API 2.0 based on row count and
 * encoded-SOQL length; writes go through Bulk 2.0. Record streams are async
 * generators (Python used sync generators).
 */
import {
  type DataSource,
  type LoadOptions,
  type QueryOptions,
  type Row,
  Column,
  Records,
  Schema,
  System,
  Table,
} from '../models.js'
import { Bulk2 } from './SfBulk2.js'
import { SfClient } from './SfClient.js'
import { HttpMethod as http, SalesforceRequestError, SKIP_NAMES, SKIP_SUFFIXES } from './SfModels.js'
import { sfTypeToPython, castRecord, prepareRecord } from './SfTypeMap.js'
import { parseCsv } from './csvUtils.js'

// A SOQL SELECT with many columns rides the GET /query request line, which
// Salesforce caps (HTTP 431). Above this encoded length, route through Bulk 2.0.
const SOQL_GET_MAX_ENCODED = 6000

// Objects with more than this many records are extracted via Bulk 2.0.
const BULK_RECORD_THRESHOLD = 2000

const SKIP_FIELD_TYPES: ReadonlySet<string> = new Set([
  'address',
  'location',
  'complexvalue',
  'base64',
])

export class Salesforce implements DataSource {
  client: SfClient
  bulk2Client: Bulk2
  environment: string | null
  namespace: string | null

  constructor(environment: string, namespace: string | null = null) {
    this.environment = environment
    this.namespace = namespace
    this.client = SfClient.clientConstructor(environment)
    this.bulk2Client = new Bulk2(this.client)
  }

  /** Stream records for a SOQL query, choosing REST vs Bulk. */
  private async *_requestRecords(soql: string, forceBulk = false): AsyncGenerator<Row> {
    if (forceBulk || encodeURIComponent(soql).length > SOQL_GET_MAX_ENCODED) {
      console.info('Using Bulk API 2.0 for query (forceBulk=%s).', forceBulk)
      yield* this._bulkQueryRecords(soql)
      return
    }

    try {
      yield* this._restQueryRecords(soql)
    } catch (e) {
      if (!(e instanceof SalesforceRequestError) || e.statusCode !== 431) throw e
      console.warn('REST query returned HTTP 431; retrying via Bulk API 2.0.')
      yield* this._bulkQueryRecords(soql)
    }
  }

  private async *_restQueryRecords(soql: string): AsyncGenerator<Row> {
    let resp = (await (await this.client.request(http.get, 'query/', { params: { q: soql } })).json()) as {
      records?: Row[]
      nextRecordsUrl?: string
    }

    for (;;) {
      for (const record of resp.records ?? []) {
        delete record.attributes
        yield record
      }

      const nextPath = resp.nextRecordsUrl
      if (!nextPath) break

      resp = (await (await this.client.request(http.get, nextPath)).json()) as {
        records?: Row[]
        nextRecordsUrl?: string
      }
    }
  }

  /** Run a SOQL query via Bulk 2.0, yielding one object per CSV row. */
  private async *_bulkQueryRecords(soql: string): AsyncGenerator<Row> {
    for await (const page of this.bulk2Client.query(soql)) {
      if (!page || page.length === 0) continue
      for (const row of parseCsv(page.toString('utf-8'))) {
        yield row
      }
    }
  }

  static isMigratable(obj: Record<string, unknown>): boolean {
    const name = String(obj.name ?? '')
    if (!obj.queryable) return false
    if (SKIP_NAMES.has(name)) return false
    return !SKIP_SUFFIXES.some((sfx) => name.endsWith(sfx))
  }

  async describeSchema(
    namespace: string | null = null,
    environment: string | null = null,
  ): Promise<Schema> {
    const resp = await this.client.describe()
    const tables: Table[] = []

    for (const obj of resp) {
      if (!Salesforce.isMigratable(obj)) continue
      tables.push(
        new Table({
          name: String(obj.name),
          system: System.salesforce,
          alias: (obj.label as string) ?? null,
          namespace,
          environment,
          properties: {
            labelPlural: obj.labelPlural,
            keyPrefix: obj.keyPrefix,
            custom: obj.custom,
            triggerable: obj.triggerable,
          },
        }),
      )
    }

    tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    return new Schema({ system: System.salesforce, namespace, environment, tables })
  }

  async describeTable(table: Table): Promise<Table> {
    const resp = (await (
      await this.client.request(http.get, `sobjects/${table.name}/describe/`)
    ).json()) as Record<string, unknown>

    const fields = (resp.fields as Record<string, unknown>[]) ?? []
    const columns: Column[] = []
    fields.forEach((f, i) => {
      if (!SKIP_FIELD_TYPES.has(String(f.type ?? ''))) {
        columns.push(this.describeColumn(f, i))
      }
    })

    return new Table({
      name: table.name,
      system: System.salesforce,
      alias: (resp.label as string) ?? null,
      namespace: table.namespace,
      environment: table.environment,
      columns,
      properties: {
        labelPlural: resp.labelPlural,
        keyPrefix: resp.keyPrefix,
        custom: resp.custom,
        triggerable: resp.triggerable,
        queryable: resp.queryable,
        searchable: resp.searchable,
      },
    })
  }

  describeColumn(field: Record<string, unknown>, position: number): Column {
    const sfType = String(field.type ?? '')
    const refTo = (field.referenceTo as string[]) ?? []
    const fkMap: Record<string, string> = refTo.length
      ? Object.fromEntries(refTo.map((ref) => [ref, 'Id']))
      : {}

    const enumValues = ((field.picklistValues as Record<string, unknown>[]) ?? [])
      .filter((pv) => pv.active)
      .map((pv) => pv.value)

    return new Column({
      name: String(field.name),
      alias: (field.label as string) ?? null,
      rawType: sfType,
      pythonType: sfTypeToPython(sfType),
      isPrimaryKey: field.name === 'Id',
      isUnique: Boolean(field.unique ?? false),
      isNullable: Boolean(field.nillable ?? true),
      isReadOnly: !(field.updateable ?? true),
      isComputed: Boolean(field.calculated ?? false),
      isDeprecated: Boolean(field.deprecatedAndHidden ?? false),
      isHidden: Boolean(field.deprecatedAndHidden ?? false),
      isIndexed: Boolean(field.idLookup ?? false) || Boolean(field.externalId ?? false),
      isForeignKey: refTo.length > 0,
      foreignKeyMapping: fkMap,
      maxLength: (field.length as number) || null,
      precision: (field.precision as number) || null,
      scale: (field.scale as number) || null,
      defaultValue: field.defaultValue,
      enumValues,
      ordinalPosition: position,
      description: (field.inlineHelpText as string) ?? null,
      properties: {
        soapType: field.soapType,
        filterable: field.filterable,
        sortable: field.sortable,
        groupable: field.groupable,
        externalId: field.externalId,
      },
    })
  }

  async query(statement: string, _opts: QueryOptions = {}): Promise<Records> {
    try {
      return new Records({ data: this._requestRecords(statement), code: 200, message: 'ok' })
    } catch (e) {
      console.error(`Error in query: ${e}`)
      return new Records({ code: 500, message: String(e) })
    }
  }

  /** True if the object has more rows than the Bulk-routing threshold. */
  private async _exceedsBulkThreshold(objectName: string): Promise<boolean> {
    try {
      return (await this.client.recordCount(objectName)) > BULK_RECORD_THRESHOLD
    } catch (e) {
      console.debug('Row-count probe failed for %s (%s); routing via REST.', objectName, e)
      return false
    }
  }

  async getRecords(table: Table, _opts: QueryOptions = {}): Promise<Records> {
    try {
      const colStr = table.columns.length
        ? table.columns.map((c) => c.name).join(', ')
        : 'FIELDS(ALL)'
      const soql = `SELECT ${colStr} FROM ${table.name}`

      const fieldTypes: Record<string, string> = {}
      for (const c of table.columns) {
        if (c.rawType) fieldTypes[c.name] = c.rawType
      }

      const forceBulk = await this._exceedsBulkThreshold(table.name)
      const raw = this._requestRecords(soql, forceBulk)

      const hasTypes = Object.keys(fieldTypes).length > 0
      const data: AsyncGenerator<Row> = hasTypes
        ? (async function* () {
            for await (const r of raw) yield castRecord(r, fieldTypes)
          })()
        : raw

      return new Records({ data, code: 200, message: 'ok' })
    } catch (e) {
      console.error(`Error in getRecords: ${e}`)
      return new Records({ code: 500, message: String(e) })
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.client.isHealthy()
    } catch (e) {
      console.error('Salesforce health check failed for %s: %s', this.environment, e)
      return false
    }
  }

  async mutateTable(table: Table, _sourceSystem: System | null = null): Promise<Table> {
    try {
      return await this.describeTable(table)
    } catch (e) {
      throw new Error(
        `Salesforce object '${table.name}' could not be described. ` +
          `Ensure the object exists in the org. Error: ${e}`,
        { cause: e },
      )
    }
  }

  async loadRecords(
    action: string,
    table: Table,
    records: Records,
    opts: LoadOptions = {},
  ): Promise<void> {
    const writable = new Set(
      table.columns.filter((c) => !c.isReadOnly && !c.isComputed).map((c) => c.name),
    )

    const rawRows: Row[] = []
    for await (const row of records.data) rawRows.push(row)

    if (rawRows.length === 0) {
      console.info('loadRecords: no records to load into %s', table.name)
      return
    }

    const sobj = this.bulk2Client.sobject(table.name)

    const prep = (row: Row, excludeId = false, keep?: Set<string>): Row => {
      const allowed = keep ? new Set([...writable, ...keep]) : writable
      const filtered: Row = {}
      for (const [k, v] of Object.entries(row)) {
        if (allowed.has(k) && !(excludeId && k === 'Id')) filtered[k] = v
      }
      return prepareRecord(filtered)
    }

    let results
    if (action === 'insert') {
      results = await sobj.insert(rawRows.map((r) => prep(r, true)))
    } else if (action === 'reset') {
      const existing: Row[] = []
      for await (const r of this._requestRecords(`SELECT Id FROM ${table.name}`)) existing.push(r)
      if (existing.length) {
        await sobj.delete(existing.map((r) => ({ Id: r.Id })))
      }
      results = await sobj.insert(rawRows.map((r) => prep(r, true)))
    } else if (action === 'upsert') {
      // Prefer an explicit field, then a column flagged externalId, else Id.
      let externalIdField = opts.externalIdField ?? null
      if (!externalIdField) {
        const extCols = table.columns.filter((c) => c.properties.externalId)
        externalIdField = extCols.length ? extCols[0].name : 'Id'
      }
      // The external id must be written even when read-only (e.g. Id).
      results = await sobj.upsert(
        rawRows.map((r) => prep(r, false, new Set([externalIdField as string]))),
        externalIdField,
      )
    } else if (action === 'update') {
      results = await sobj.update(rawRows.map((r) => prep(r, false, new Set(['Id']))))
    } else {
      throw new Error(`Unknown load action '${action}' for Salesforce target`)
    }

    const total = results.reduce((sum, r) => sum + (r.numberRecordsProcessed ?? 0), 0)
    const failed = results.reduce((sum, r) => sum + (r.numberRecordsFailed ?? 0), 0)

    console.info('loadRecords: %s %d records into %s (%d failed)', action, total, table.name, failed)
    if (failed) {
      console.warn('loadRecords: %d records failed in %s', failed, table.name)
    }
  }
}
