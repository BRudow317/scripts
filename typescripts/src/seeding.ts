/**
 * seeding.ts
 *
 * Orchestrates cross-system migrations using the system-agnostic DataSource
 * contract, ported from src/seeding.py. The same flow handles all four
 * directions (sf->oracle, oracle->sf, oracle->oracle, sf->sf):
 *
 *   describe source table -> mutate (create/align) target table ->
 *   stream source records -> rename keys to target column names -> load.
 */
import {
  type DataSource,
  type Row,
  Column,
  Records,
  Schema,
  System,
  Table,
  toSystem,
} from './models.js'
import { Oracle } from './oracle/Oracle.js'
import { toOracleSnake } from './oracle/OracleModels.js'
import { Salesforce } from './sf/Salesforce.js'
import { SalesforceRequestError } from './sf/SfModels.js'

export function getDatasource(
  system: System,
  environment: string,
  namespace: string | null,
): DataSource {
  if (toSystem(system) === System.oracle) {
    return new Oracle(environment, namespace)
  }
  return new Salesforce(environment, namespace)
}

/**
 * Resolve the table/object name to use on the target system.
 *
 *   SF -> Oracle: prepend 'SF_' and snake-case -> SF_CONTACT
 *   Oracle -> SF: prepend 'ora_', lowercase, append '__c' -> ora_contact__c
 *
 * Round-trip detection: a name already carrying the target's prefix is returning
 * home, so the prefix is stripped instead of double-prefixed.
 */
export function resolveCrossSystemName(
  sourceName: string,
  sourceSystem: System,
  targetSystem: System,
): string {
  const src = toSystem(sourceSystem)
  const tgt = toSystem(targetSystem)

  if (src === tgt) return sourceName

  if (src === System.salesforce && tgt === System.oracle) {
    if (sourceName.toLowerCase().startsWith('ora_')) {
      let stripped = sourceName.slice(4)
      if (stripped.toLowerCase().endsWith('__c')) {
        stripped = stripped.slice(0, -3)
      }
      return toOracleSnake(stripped)
    }
    return `SF_${toOracleSnake(sourceName)}`
  }

  if (src === System.oracle && tgt === System.salesforce) {
    if (sourceName.toUpperCase().startsWith('SF_')) {
      return sourceName.slice(3)
    }
    return `ora_${sourceName.toLowerCase()}__c`
  }

  return sourceName
}

/**
 * Map each source column name to its corresponding target column name through a
 * canonical (Oracle snake-case) form, which is idempotent and thus stable in
 * every direction.
 */
function buildRenameMap(sourceColumns: Column[], targetColumns: Column[]): Record<string, string> {
  const targetByCanon: Record<string, string> = {}
  for (const c of targetColumns) {
    targetByCanon[toOracleSnake(c.name)] = c.name
  }
  const rename: Record<string, string> = {}
  for (const col of sourceColumns) {
    const targetName = targetByCanon[toOracleSnake(col.name)]
    if (targetName !== undefined) {
      rename[col.name] = targetName
    }
  }
  return rename
}

/** Lazily rewrite record keys from source names to target column names. */
function renameRecords(records: Records, rename: Record<string, string>): Records {
  if (Object.keys(rename).length === 0) return records

  const sourceData = records.data

  async function* renamed(): AsyncGenerator<Row> {
    for await (const row of sourceData) {
      const out: Row = {}
      for (const [k, v] of Object.entries(row)) {
        out[rename[k] ?? k] = v
      }
      yield out
    }
  }

  return new Records({
    data: renamed(),
    columns: records.columns,
    code: records.code,
    message: records.message,
  })
}

export interface SeedingArgs {
  sourceSystem: System
  sourceEnvironment: string
  sourceNamespace: string | null
  targetSystem: System
  targetEnvironment: string
  targetNamespace: string | null
  tables: string[]
  action?: string
  externalIdField?: string | null
}

export async function seeding(args: SeedingArgs): Promise<number> {
  const sourceSystem = toSystem(args.sourceSystem)
  const targetSystem = toSystem(args.targetSystem)
  const action = args.action ?? 'reset'

  const source: DataSource = getDatasource(sourceSystem, args.sourceEnvironment, args.sourceNamespace)
  const target: DataSource = getDatasource(targetSystem, args.targetEnvironment, args.targetNamespace)

  let tables = args.tables
  if (tables.length && tables[0] === '*') {
    const schema: Schema = await source.describeSchema(source.namespace)
    tables = schema.tables.map((t) => t.name)
  }

  const skipped: string[] = []

  for (const tableName of tables) {
    try {
      const sourceStub = new Table({
        name: tableName,
        system: sourceSystem,
        environment: args.sourceEnvironment,
        namespace: args.sourceNamespace,
      })
      const describedSourceTable = await source.describeTable(sourceStub)

      const targetName = resolveCrossSystemName(tableName, sourceSystem, targetSystem)
      const targetStub = new Table({
        name: targetName,
        system: targetSystem,
        environment: args.targetEnvironment,
        namespace: args.targetNamespace,
        columns: describedSourceTable.columns,
      })
      const targetTable = await target.mutateTable(targetStub, sourceSystem)

      const records = await source.getRecords(describedSourceTable)
      if (records.code !== 200) {
        throw new Error(
          `Failed to read records from ${describedSourceTable.name}: ${records.message}`,
        )
      }

      const rename = buildRenameMap(describedSourceTable.columns, targetTable.columns)
      const renamedRecords = renameRecords(records, rename)

      // Source records stream lazily, so a Salesforce access denial on the
      // underlying SOQL surfaces here, during load, not above.
      await target.loadRecords(action, targetTable, renamedRecords, {
        externalIdField: args.externalIdField ?? null,
      })
      console.info('Migrated %s -> %s (action=%s)', tableName, targetName, action)
    } catch (e) {
      if (e instanceof SalesforceRequestError && e.isAccessError) {
        // The user can't read this object; skip it so one inaccessible table
        // doesn't abort the whole migration.
        console.warn(
          "Skipping '%s': Salesforce access denied (%s).",
          tableName,
          e.errorCodes.join(', ') || e.statusCode,
        )
        skipped.push(tableName)
      } else {
        throw e
      }
    }
  }

  const migrated = tables.length - skipped.length
  if (skipped.length) {
    console.info(
      'Seeding complete: %d migrated, %d skipped (access denied): %s',
      migrated,
      skipped.length,
      skipped.join(', '),
    )
  } else {
    console.info('Seeding complete: %d table(s).', migrated)
  }
  return 0
}
