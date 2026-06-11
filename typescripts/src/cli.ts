#!/usr/bin/env node
/**
 * cli.ts
 *
 * Command-line entry point for the migration engine, ported from src/app.py.
 * It also folds in the one charon.py responsibility that still applies under
 * Node: loading the secrets .env before any client is constructed. (Node needs
 * no venv/PYTHONPATH bootstrap, so the rest of charon.py has no equivalent.)
 *
 * Usage:
 *   npm run migrate -- \
 *     --source-system salesforce --source-environment TRAIL --source-namespace TRAIL \
 *     --target-system oracle     --target-environment DWH   --target-namespace DWH \
 *     --action upsert --tables Contact Account
 */
import { loadEnv } from './env.js'
import { type SeedingArgs, seeding } from './seeding.js'
import { System, toSystem } from './models.js'

const ACTIONS = new Set(['reset', 'insert', 'upsert', 'update'])

function parseArgs(argv: string[]): SeedingArgs {
  const single: Record<string, string> = {}
  let tables: string[] | null = null

  let i = 0
  while (i < argv.length) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`)
    }

    let key = token.slice(2)
    let inlineValue: string | null = null
    const eq = key.indexOf('=')
    if (eq !== -1) {
      inlineValue = key.slice(eq + 1)
      key = key.slice(0, eq)
    }

    if (key === 'tables') {
      tables = []
      if (inlineValue !== null) tables.push(inlineValue)
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        tables.push(argv[++i])
      }
      i++
      continue
    }

    const value = inlineValue ?? argv[++i]
    if (value === undefined) throw new Error(`Missing value for --${key}`)
    single[key] = value
    i++
  }

  const required = ['source-system', 'source-environment', 'target-system', 'target-environment']
  for (const r of required) {
    if (!single[r]) throw new Error(`Missing required argument: --${r}`)
  }

  const action = single['action'] ?? 'reset'
  if (!ACTIONS.has(action)) {
    throw new Error(`Invalid --action '${action}' (choices: ${[...ACTIONS].join(', ')})`)
  }

  const sourceSystem: System = toSystem(single['source-system'])
  const targetSystem: System = toSystem(single['target-system'])

  return {
    sourceSystem,
    sourceEnvironment: single['source-environment'],
    sourceNamespace: single['source-namespace'] ?? null,
    targetSystem,
    targetEnvironment: single['target-environment'],
    targetNamespace: single['target-namespace'] ?? null,
    tables: tables ?? ['*'],
    action,
    externalIdField: single['external-id-field'] ?? null,
  }
}

async function main(): Promise<number> {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))
  return seeding(args)
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Clean message for the CLI; full stack only when DEBUG is set.
    console.error(process.env.DEBUG ? err : `Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
