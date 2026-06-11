/**
 * models.ts
 *
 * System-agnostic data structures and the DataSource contract, ported from
 * charon's src/models.py. The one structural change from Python: record streams
 * are AsyncIterable rather than sync iterators, because every Node data source
 * (oracledb fetch, fetch() HTTP) is asynchronous. DataSource methods therefore
 * return Promises.
 */

export type Row = Record<string, unknown>

export const System = {
  oracle: 'oracle',
  salesforce: 'salesforce',
} as const
export type System = (typeof System)[keyof typeof System]

export function toSystem(value: string | System): System {
  const v = String(value).toLowerCase()
  if (v === System.oracle) return System.oracle
  if (v === System.salesforce) return System.salesforce
  throw new Error(`Unknown system: ${value}`)
}

export const SystemPrefix = {
  oracle: 'ora',
  salesforce: 'sf',
} as const
export type SystemPrefix = (typeof SystemPrefix)[keyof typeof SystemPrefix]

export const PythonTypes = {
  string: 'string',
  integer: 'integer',
  float: 'float',
  boolean: 'boolean',
  datetime: 'datetime', // Date + timezone
  date: 'date', // calendar date
  time: 'time', // time-of-day
  byte: 'byte',
  bytearray: 'bytearray',
  json: 'json', // object or array
} as const
export type PythonTypes = (typeof PythonTypes)[keyof typeof PythonTypes]

export interface ColumnInit {
  name: string
  alias?: string | null
  rawType?: string | null
  pythonType?: PythonTypes | null
  isPrimaryKey?: boolean
  isUnique?: boolean
  isNullable?: boolean
  isReadOnly?: boolean
  isCompoundKey?: boolean
  isForeignKey?: boolean
  foreignKeyMapping?: Record<string, string>
  isForeignKeyEnforced?: boolean
  maxLength?: number | null
  precision?: number | null
  scale?: number | null
  serializedNullValue?: string | null
  defaultValue?: unknown
  enumValues?: unknown[]
  timezone?: string | null
  properties?: Record<string, unknown>
  ordinalPosition?: number | null
  isComputed?: boolean
  formula?: string | null
  isDeprecated?: boolean
  isHidden?: boolean
  isIndexed?: boolean
  description?: string | null
}

export class Column {
  name: string
  alias: string | null
  rawType: string | null
  pythonType: PythonTypes | null
  isPrimaryKey: boolean
  isUnique: boolean
  isNullable: boolean
  isReadOnly: boolean
  isCompoundKey: boolean
  isForeignKey: boolean
  foreignKeyMapping: Record<string, string>
  isForeignKeyEnforced: boolean
  maxLength: number | null
  precision: number | null
  scale: number | null
  serializedNullValue: string | null
  defaultValue: unknown
  enumValues: unknown[]
  timezone: string | null
  properties: Record<string, unknown>
  ordinalPosition: number | null
  isComputed: boolean
  formula: string | null
  isDeprecated: boolean
  isHidden: boolean
  isIndexed: boolean
  description: string | null

  constructor(init: ColumnInit) {
    this.name = init.name
    this.alias = init.alias ?? null
    this.rawType = init.rawType ?? null
    this.pythonType = init.pythonType ?? null
    this.isPrimaryKey = init.isPrimaryKey ?? false
    this.isUnique = init.isUnique ?? false
    this.isNullable = init.isNullable ?? true
    this.isReadOnly = init.isReadOnly ?? false
    this.isCompoundKey = init.isCompoundKey ?? false
    this.isForeignKey = init.isForeignKey ?? false
    this.foreignKeyMapping = init.foreignKeyMapping ?? {}
    this.isForeignKeyEnforced = init.isForeignKeyEnforced ?? false
    this.maxLength = init.maxLength ?? null
    this.precision = init.precision ?? null
    this.scale = init.scale ?? null
    this.serializedNullValue = init.serializedNullValue ?? null
    this.defaultValue = init.defaultValue ?? null
    this.enumValues = init.enumValues ?? []
    this.timezone = init.timezone ?? null
    this.properties = init.properties ?? {}
    this.ordinalPosition = init.ordinalPosition ?? null
    this.isComputed = init.isComputed ?? false
    this.formula = init.formula ?? null
    this.isDeprecated = init.isDeprecated ?? false
    this.isHidden = init.isHidden ?? false
    this.isIndexed = init.isIndexed ?? false
    this.description = init.description ?? null
  }
}

export interface TableInit<C extends Column = Column> {
  name: string
  system: System
  environment?: string | null
  alias?: string | null
  namespace?: string | null
  prefix?: string | null
  columns?: C[]
  recordCount?: number | null
  properties?: Record<string, unknown>
}

export class Table<C extends Column = Column> {
  name: string
  system: System
  environment: string | null
  alias: string | null
  namespace: string | null
  prefix: string | null
  columns: C[]
  recordCount: number | null
  properties: Record<string, unknown>

  constructor(init: TableInit<C>) {
    this.name = init.name
    this.system = init.system
    this.environment = init.environment ?? null
    this.alias = init.alias ?? null
    this.namespace = init.namespace ?? null
    this.prefix = init.prefix ?? null
    this.columns = init.columns ?? []
    this.recordCount = init.recordCount ?? null
    this.properties = init.properties ?? {}
  }

  get primaryKeyColumns(): C[] {
    return this.columns.filter((c) => c.isPrimaryKey)
  }

  get columnMap(): Record<string, C> {
    return Object.fromEntries(this.columns.map((c) => [c.name, c]))
  }
}

export class Schema {
  namespace: string | null
  environment: string | null
  system: System | null
  tables: Table[]

  constructor(init: {
    namespace?: string | null
    environment?: string | null
    system?: System | null
    tables?: Table[]
  } = {}) {
    this.namespace = init.namespace ?? null
    this.environment = init.environment ?? null
    this.system = init.system ?? null
    this.tables = init.tables ?? []
  }
}

async function* emptyStream(): AsyncGenerator<Row> {
  // yields nothing
}

export class Records {
  data: AsyncIterable<Row>
  columns: Column[]
  code: number
  message: string

  constructor(init: {
    data?: AsyncIterable<Row>
    columns?: Column[]
    code?: number
    message?: string
  } = {}) {
    this.data = init.data ?? emptyStream()
    this.columns = init.columns ?? []
    this.code = init.code ?? 200
    this.message = init.message ?? 'ok'
  }
}

export interface QueryOptions {
  binds?: Record<string, unknown>
  [key: string]: unknown
}

export interface LoadOptions {
  externalIdField?: string | null
  batchSize?: number
  [key: string]: unknown
}

export interface DataSource {
  environment: string | null
  namespace: string | null
  isHealthy(): Promise<boolean>
  describeSchema(namespace?: string | null): Promise<Schema>
  describeTable(table: Table): Promise<Table>
  mutateTable(table: Table, sourceSystem?: System | null): Promise<Table>
  query(statement: string, opts?: QueryOptions): Promise<Records>
  getRecords(table: Table, opts?: QueryOptions): Promise<Records>
  loadRecords(action: string, table: Table, records: Records, opts?: LoadOptions): Promise<void>
}
