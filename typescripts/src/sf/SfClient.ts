/**
 * SfClient.ts
 *
 * Simplified Salesforce REST client, ported from src/sf/SfClient.py. charon
 * built its own client on httpx; this rebuilds it on Node's global fetch. The
 * one behavioral change: the OAuth token is fetched lazily on first request
 * (fetch is async and cannot run in a constructor) rather than eagerly in
 * __init__. Auth uses the OAuth 2.0 client-credentials flow.
 */
import {
  HttpMethod,
  HttpMethod as http,
  SalesforceRequestError,
  SKIP_NAMES,
  SKIP_SUFFIXES,
} from './SfModels.js'

export interface RequestOptions {
  params?: Record<string, string>
  json?: unknown
  content?: string | Uint8Array
  headers?: Record<string, string>
}

export class SfClient {
  baseUrl: string
  authUrl: string
  servicesUrl: string
  apiVersion: string
  environment: string
  private consumerKey: string | null
  private consumerSecret: string | null
  private _accessToken: string
  private _maxRetries: number

  constructor(opts: {
    environment: string
    baseUrl: string
    authUrl?: string
    consumerKey?: string | null
    consumerSecret?: string | null
    accessToken?: string | null
    apiVersion?: string
    maxRetries?: number
  }) {
    this.environment = opts.environment
    this.baseUrl = String(this.resolveUrl(opts.baseUrl))
    this.authUrl = String(this.resolveUrl(opts.authUrl ?? '/services/oauth2/token'))
    this.consumerKey = opts.consumerKey ?? null
    this.consumerSecret = opts.consumerSecret ?? null
    this._accessToken = opts.accessToken ?? ''
    this.apiVersion = opts.apiVersion ?? '66.0'
    this.servicesUrl = String(
      this.resolveUrl(`/services/data/v${this.apiVersion}/`, this.baseUrl),
    )
    this._maxRetries = opts.maxRetries ?? 1
  }

  static clientConstructor(
    environment: string,
    maxRetries = 1,
    accessToken: string | null = null,
  ): SfClient {
    const E = environment.toUpperCase()
    const baseUrl = process.env[`SF_${E}_BASE_URL`] || ''
    const consumerKey = process.env[`SF_${E}_CONSUMER_KEY`] || ''
    const consumerSecret = process.env[`SF_${E}_CONSUMER_SECRET`] || ''
    // const apiVersion = process.env[`SF_${E}_API_VERSION`] || '66.0'

    if (!baseUrl || !consumerKey || !consumerSecret) {
      throw new Error(
        `Missing Salesforce connection info for environment '${environment}'. ` +
          `Required variables: SF_${E}_BASE_URL, SF_${E}_CONSUMER_KEY, SF_${E}_CONSUMER_SECRET`,
      )
    }

    return new SfClient({
      environment: E,
      baseUrl,
      consumerKey,
      consumerSecret,
      accessToken,
      apiVersion: '66.0',
      maxRetries,
    })
  }

  /** Fetch an OAuth access token using the client-credentials flow. */
  private async _authCallout(): Promise<string> {
    if (!this.consumerKey || !this.consumerSecret || !this.authUrl) {
      const envDebug = Object.fromEntries(
        Object.entries(process.env)
          .filter(([k]) => k.startsWith('SF_'))
          .map(([k, v]) => [k, v ? '*'.repeat(v.length) : '[EMPTY STRING]']),
      )
      throw new Error(
        `Missing required environment variables for authentication: ${JSON.stringify(envDebug)}`,
      )
    }

    console.info(`\nInitiating Salesforce OAuth callout to: ${this.authUrl}\n...`)

    let response: Response
    try {
      response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.consumerKey,
          client_secret: this.consumerSecret,
        }),
      })
    } catch (exc) {
      console.error(`Network transport error during authentication: ${exc}`)
      throw new Error(`Failed to connect to Salesforce auth endpoint: ${exc}`, { cause: exc })
    }

    const text = await response.text()
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(text)
    } catch (exc) {
      throw new Error(`Non-JSON response received (${response.status}): ${text}`, { cause: exc })
    }

    if (response.status !== 200) {
      const errorType = String(payload.error ?? 'unknown_error')
      const errorDesc = String(payload.error_description ?? 'No description provided by Salesforce.')
      console.error(`Salesforce OAuth Rejected [${response.status}]: ${errorType} - ${errorDesc}`)
      if (errorType === 'invalid_grant') {
        console.error(
          "Check if the External Client App 'Enable Client Credentials Flow' policy is checked and a 'Run As' user is set.",
        )
      } else if (errorType === 'invalid_client') {
        console.error(
          'Verify that your Client ID (Consumer Key) and Client Secret match Salesforce exactly.',
        )
      }
      throw new Error(`Salesforce Auth Failure (${errorType}): ${errorDesc}`)
    }

    console.info('Salesforce OAuth authentication successful.')
    return String(payload.access_token ?? '')
  }

  private async _ensureToken(): Promise<void> {
    if (!this._accessToken) {
      this._accessToken = await this._authCallout()
    }
  }

  private _authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this._accessToken}`,
    }
  }

  resolveUrl(urlPart?: string | null, base?: string): URL {
    const part = String(urlPart ?? '')
    try {
      const direct = new URL(part)
      return direct // absolute
    } catch {
      // relative; fall through
    }
    const target = base ?? this.baseUrl
    const url = new URL(part, target)
    return url
  }

  private _resolveRequestUrl(url: string): URL {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (!url.startsWith('/services')) {
        return new URL(url.replace(/^\/+/, ''), this.servicesUrl)
      }
      return this.resolveUrl(url, this.baseUrl)
    }
    return new URL(url)
  }

  private async _fetch(
    method: HttpMethod,
    url: URL,
    opts: RequestOptions,
  ): Promise<Response> {
    const target = new URL(url)
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        target.searchParams.set(k, v)
      }
    }

    const headers: Record<string, string> = { ...this._authHeaders(), ...(opts.headers ?? {}) }
    let body: string | Uint8Array | undefined
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json)
      headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    } else if (opts.content !== undefined) {
      body = opts.content
    }

    return fetch(target, { method, headers, body })
  }

  async request(method: HttpMethod, url: URL | string, opts: RequestOptions = {}): Promise<Response> {
    await this._ensureToken()
    const resolved = this._resolveRequestUrl(String(url))

    let response = await this._fetch(method, resolved, opts)

    if (response.status === 401) {
      await this._handle401(response)
      response = await this._fetch(method, resolved, opts)
    }

    if (response.status >= 300) {
      const body = await response.text()
      throw new SalesforceRequestError(response.status, method, resolved, body)
    }

    return response
  }

  async isHealthy(): Promise<boolean> {
    await this._ensureToken()
    const url = this.resolveUrl('/services/oauth2/userinfo')
    const response = await fetch(url, { headers: this._authHeaders() })
    if (!response.ok) {
      throw new SalesforceRequestError(response.status, http.get, url, await response.text())
    }
    const info = (await response.json()) as { organization_id?: string }
    console.debug(`Connection is healthy. Org ID: ${String(info.organization_id)}`)
    return true
  }

  /** Global describe filtered to business-data objects only. */
  async describe(): Promise<Record<string, unknown>[]> {
    const allObjects = ((await this.describeAll()).sobjects ?? []) as Record<string, unknown>[]

    const isMigratable = (obj: Record<string, unknown>): boolean => {
      if (!obj.queryable || !obj.retrieveable) return false
      if (!obj.layoutable && !obj.searchable) return false
      const name = String(obj.name ?? '')
      if (SKIP_SUFFIXES.some((s) => name.endsWith(s))) return false
      if (SKIP_NAMES.has(name)) return false
      return true
    }

    return allObjects.filter(isMigratable)
  }

  /** Global describe - all available SObjects. */
  async describeAll(): Promise<{ sobjects?: Record<string, unknown>[] }> {
    const response = await this.request(http.get, 'sobjects')
    return (await response.json()) as { sobjects?: Record<string, unknown>[] }
  }

  /** Execute a SOQL query; returns the first page. */
  async query(queryStr: string, includeDeleted = false): Promise<Record<string, unknown>> {
    const endpoint = includeDeleted ? 'queryAll/' : 'query/'
    const response = await this.request(http.get, endpoint, { params: { q: queryStr } })
    return (await response.json()) as Record<string, unknown>
  }

  /** Return the row count of an SObject via a lightweight SELECT COUNT(). */
  async recordCount(sobject: string, includeDeleted = false): Promise<number> {
    const resp = await this.query(`SELECT COUNT() FROM ${sobject}`, includeDeleted)
    return Number(resp.totalSize ?? 0)
  }

  async queryMore(
    nextRecordsIdentifier: string,
    identifierIsUrl = false,
    includeDeleted = false,
  ): Promise<Record<string, unknown>> {
    let endpoint: string
    if (identifierIsUrl) {
      endpoint = nextRecordsIdentifier
    } else {
      const base = includeDeleted ? 'queryAll' : 'query'
      endpoint = `${base}/${nextRecordsIdentifier}`
    }
    const response = await this.request(http.get, endpoint)
    return (await response.json()) as Record<string, unknown>
  }

  /** Lazily yield individual records across all pages. */
  async *lazyQuery(queryStr: string, includeDeleted = false): AsyncGenerator<Record<string, unknown>> {
    let result = await this.query(queryStr, includeDeleted)
    for (;;) {
      for (const record of (result.records as Record<string, unknown>[]) ?? []) {
        yield record
      }
      if (result.done) return
      result = await this.queryMore(String(result.nextRecordsUrl), true, includeDeleted)
    }
  }

  /** Refresh the token on INVALID_SESSION_ID. */
  private async _handle401(response: Response): Promise<void> {
    let errorCode: unknown
    try {
      const payload = (await response.clone().json()) as { errorCode?: unknown }
      errorCode = payload.errorCode
    } catch {
      return
    }

    if (errorCode !== 'INVALID_SESSION_ID') return

    console.info('Session expired. Refreshing token...')
    for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
      const newToken = await this._authCallout()
      if (newToken && newToken !== this._accessToken) {
        this._accessToken = newToken
        return
      }
      console.warn(`Token refresh attempt ${attempt} returned same or empty token.`)
    }
    throw new Error('Max retries exceeded: could not refresh Salesforce token.')
  }
}
