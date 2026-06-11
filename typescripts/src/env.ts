/**
 * env.ts
 *
 * 
 */
import { existsSync, readFileSync } from 'node:fs'

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\}/g

export function defaultSecretsPath(): string {
  return (
    process.env.SCIPIO_SECRETS_ENV ||
    // Documented location of the shared secrets file.
    'Q:\\.secrets\\.env'
  )
}

/**
 * Parse a `.env`-style file into a flat record, resolving variable references.
 * Returns `{}` when no path is given and the default file is absent (matching
 * charon's "implicit path is optional" behavior); throws when an explicit path
 * is supplied but missing.
 */
export function parseConfigFile(configPath?: string, env = ''): Record<string, string> {
  const explicit = Boolean(configPath)
  const path = configPath || defaultSecretsPath()

  if (!existsSync(path)) {
    if (explicit) {
      throw new Error(`Config file not found: ${path}`)
    }
    return {}
  }

  const raw: Record<string, string> = {}
  for (let line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('#') || line.startsWith('!') || !line.includes('=')) {
      continue
    }
    const eq = line.indexOf('=')
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    raw[key] = val
  }

  const lookup: Record<string, string | undefined> = {
    ...process.env,
    ...raw,
    env,
    ENV: env,
  }

  const interpolate = (value: string): string => {
    let previous: string | null = null
    let loops = 0
    let current = value
    while (current !== previous && loops < 10) {
      previous = current
      current = current.replace(VAR_RE, (match, g1, g2, g3) => {
        const name = g1 || g2 || g3
        const resolved = lookup[name]
        return resolved !== undefined ? resolved : match
      })
      loops += 1
    }
    return current
  }

  const resolved: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    resolved[k] = interpolate(v)
  }
  return resolved
}

/**
 * Load secrets into `process.env` without clobbering values already present
 * (mirrors charon's tests/conftest.py `_load_env`). Returns the parsed values.
 */
export function loadEnv(configPath?: string, env = ''): Record<string, string> {
  const resolved = parseConfigFile(configPath, env)
  for (const [k, v] of Object.entries(resolved)) {
    if (process.env[k] === undefined) {
      process.env[k] = v
    }
  }
  return resolved
}
