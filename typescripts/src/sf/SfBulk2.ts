/**
 * SfBulk2.ts
 *
 * Salesforce Bulk API 2.0 engine, ported from src/sf/SfBulk2.py. Handles ingest
 * (insert/upsert/update/delete) by serializing records to in-memory CSV and
 * polling the job to completion, and query by streaming CSV result pages.
 * https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/bulk_api_2_0.htm
 *
 * Change from Python: charon used getattr(bulk2, name) to address an SObject;
 * Node uses an explicit `bulk2.sobject(name)` method instead of a Proxy.
 */
import type { SfClient } from './SfClient.js'
import { HttpMethod as http, Operation } from './SfModels.js'
import { ColumnDelimiter, LineEnding, recordsToCsvBytes } from './csvUtils.js'

export const MAX_INGEST_JOB_FILE_SIZE = 150 * 1024 * 1024 // 150 MB per job
export const DEFAULT_QUERY_PAGE_SIZE = 50_000

export const JobState = {
  open: 'Open',
  aborted: 'Aborted',
  failed: 'Failed',
  uploadComplete: 'UploadComplete',
  inProgress: 'InProgress',
  jobComplete: 'JobComplete',
} as const
export type JobState = (typeof JobState)[keyof typeof JobState]

export const ResultsType = {
  failed: 'failedResults',
  successful: 'successfulResults',
  unprocessed: 'unprocessedRecords',
} as const

export interface IngestResult {
  numberRecordsFailed: number
  numberRecordsProcessed: number
  numberRecordsTotal: number
  job_id: string
}

const sleep = (seconds: number) => new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1000))

function filterNullBytes(buf: Buffer): Buffer {
  // Strip embedded NULs (Bulk results can contain them). Allocating a filtered
  // copy keeps the API identical to Python's bytes.replace.
  const out = Buffer.alloc(buf.length)
  let j = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) out[j++] = buf[i]
  }
  return out.subarray(0, j)
}

export class Bulk2 {
  private _http: SfClient
  bulk2Url: string

  constructor(httpClient: SfClient) {
    this._http = httpClient
    // Avoid the double slash Python produced from `${services_url}/jobs/`.
    this.bulk2Url = `${this._http.servicesUrl.replace(/\/$/, '')}/jobs/`
  }

  sobject(name: string): Bulk2SObject {
    return new Bulk2SObject(name, this.bulk2Url, this._http)
  }

  query(soql: string, maxRecords = DEFAULT_QUERY_PAGE_SIZE): AsyncGenerator<Buffer> {
    return new Bulk2SObject('_query', this.bulk2Url, this._http).query(soql, maxRecords)
  }

  queryAll(soql: string, maxRecords = DEFAULT_QUERY_PAGE_SIZE): AsyncGenerator<Buffer> {
    return new Bulk2SObject('_query', this.bulk2Url, this._http).queryAll(soql, maxRecords)
  }
}

export class Bulk2SObject {
  objectName: string
  private _client: Bulk2Client

  constructor(objectName: string, bulk2Url: string, httpClient: SfClient) {
    this.objectName = objectName
    this._client = new Bulk2Client(objectName, bulk2Url, httpClient)
  }

  private static _splitRecords(
    records: Record<string, unknown>[],
    chunkSize: number | null,
  ): Record<string, unknown>[][] {
    const size = chunkSize || Math.floor(MAX_INGEST_JOB_FILE_SIZE / 500)
    const out: Record<string, unknown>[][] = []
    for (let i = 0; i < records.length; i += size) {
      out.push(records.slice(i, i + size))
    }
    return out
  }

  private async _uploadChunk(
    operation: Operation,
    data: Buffer,
    recordCount: number,
    externalIdField: string | null,
    wait: number,
  ): Promise<IngestResult> {
    const res = await this._client.createJob(operation, {
      externalIdField,
      lineEnding: LineEnding.LF,
      columnDelimiter: ColumnDelimiter.COMMA,
    })
    const jobId = res.id ?? res.jobId ?? res.job_id
    if (!jobId) {
      throw new Error(`Failed to create job for chunk upload: ${JSON.stringify(res)}`)
    }

    try {
      if (res.state !== JobState.open) {
        throw new Error(`Job ${jobId} created in unexpected state: ${String(res.state)}`)
      }

      await this._client.uploadJobData(jobId, data)
      await this._client.closeJob(jobId)
      await this._client.waitForJob(jobId, false, wait)
      const final = await this._client.getJob(jobId, false)

      return {
        numberRecordsFailed: Number(final.numberRecordsFailed ?? 0),
        numberRecordsProcessed: Number(final.numberRecordsProcessed ?? 0),
        numberRecordsTotal: recordCount,
        job_id: jobId,
      }
    } catch (err) {
      try {
        const current = await this._client.getJob(jobId, false)
        const state = current.state
        if (
          state === JobState.uploadComplete ||
          state === JobState.inProgress ||
          state === JobState.open
        ) {
          await this._client.abortJob(jobId, false)
        }
      } catch (abortErr) {
        console.warn(`Failed to abort job ${jobId} during cleanup: ${abortErr}`)
      }
      throw err
    }
  }

  private async _uploadTable(
    operation: Operation,
    records: Record<string, unknown>[],
    chunkSize: number | null = null,
    externalIdField: string | null = null,
    wait = 5,
  ): Promise<IngestResult[]> {
    const chunks = Bulk2SObject._splitRecords(records, chunkSize)
    const results: IngestResult[] = []
    for (const chunk of chunks) {
      const data = recordsToCsvBytes(chunk, LineEnding.LF)
      results.push(await this._uploadChunk(operation, data, chunk.length, externalIdField, wait))
    }
    return results
  }

  insert(records: Record<string, unknown>[], chunkSize: number | null = null, wait = 5): Promise<IngestResult[]> {
    return this._uploadTable(Operation.insert, records, chunkSize, null, wait)
  }

  upsert(
    records: Record<string, unknown>[],
    externalIdField: string,
    chunkSize: number | null = null,
    wait = 5,
  ): Promise<IngestResult[]> {
    return this._uploadTable(Operation.upsert, records, chunkSize, externalIdField, wait)
  }

  update(records: Record<string, unknown>[], chunkSize: number | null = null, wait = 5): Promise<IngestResult[]> {
    return this._uploadTable(Operation.update, records, chunkSize, null, wait)
  }

  delete(records: Record<string, unknown>[], wait = 5): Promise<IngestResult[]> {
    Bulk2SObject._constrainIdOnly(records)
    return this._uploadTable(Operation.delete, records, null, null, wait)
  }

  hardDelete(records: Record<string, unknown>[], wait = 5): Promise<IngestResult[]> {
    Bulk2SObject._constrainIdOnly(records)
    return this._uploadTable(Operation.hardDelete, records, null, null, wait)
  }

  private static _constrainIdOnly(records: Record<string, unknown>[]): void {
    if (records.length === 0) return
    const keys = Object.keys(records[0]).map((k) => k.toLowerCase())
    if (keys.length !== 1 || keys[0] !== 'id') {
      throw new Error(
        `Delete operations require records with only an 'Id' key. Got: ${JSON.stringify(Object.keys(records[0]))}`,
      )
    }
  }

  async *query(query: string, maxRecords = DEFAULT_QUERY_PAGE_SIZE, wait = 5): AsyncGenerator<Buffer> {
    yield* this._runQuery(Operation.query, query, maxRecords, wait)
  }

  async *queryAll(query: string, maxRecords = DEFAULT_QUERY_PAGE_SIZE, wait = 5): AsyncGenerator<Buffer> {
    yield* this._runQuery(Operation.queryAll, query, maxRecords, wait)
  }

  private async *_runQuery(
    operation: Operation,
    query: string,
    maxRecords: number,
    wait: number,
  ): AsyncGenerator<Buffer> {
    const res = await this._client.createJob(operation, { query, lineEnding: LineEnding.LF })
    const jobId = res.id as string
    await this._client.waitForJob(jobId, true, wait)

    let locator = ''
    let first = true
    while (first || locator) {
      first = false
      const result = await this._client.getQueryResults(jobId, locator, maxRecords)
      locator = result.locator
      yield result.data
    }
  }

  getSuccessfulRecords(jobId: string): Promise<Buffer> {
    return this._client.getIngestResults(jobId, ResultsType.successful)
  }

  getFailedRecords(jobId: string): Promise<Buffer> {
    return this._client.getIngestResults(jobId, ResultsType.failed)
  }

  getUnprocessedRecords(jobId: string): Promise<Buffer> {
    return this._client.getIngestResults(jobId, ResultsType.unprocessed)
  }
}

const JSON_CONTENT_TYPE = 'application/json'
const CSV_CONTENT_TYPE = 'text/csv; charset=UTF-8'
const DEFAULT_WAIT_TIMEOUT_SECONDS = 7800
const MAX_CHECK_INTERVAL_SECONDS = 60.0

interface JobInfo {
  id?: string
  jobId?: string
  job_id?: string
  state?: string
  numberRecordsFailed?: number
  numberRecordsProcessed?: number
  errorMessage?: string
  [key: string]: unknown
}

/** Low-level Bulk 2.0 HTTP operations. Not for direct use outside Bulk2SObject. */
class Bulk2Client {
  objectName: string
  bulk2Url: string
  private _http: SfClient

  constructor(objectName: string, bulk2Url: string, httpClient: SfClient) {
    this.objectName = objectName
    this.bulk2Url = bulk2Url
    this._http = httpClient
  }

  private _headers(contentType?: string, accept?: string): Record<string, string> {
    return {
      'Content-Type': contentType || JSON_CONTENT_TYPE,
      Accept: accept || JSON_CONTENT_TYPE,
    }
  }

  private _url(jobId: string | null, isQuery: boolean): string {
    const base = this.bulk2Url + (isQuery ? 'query' : 'ingest')
    return jobId ? `${base}/${jobId}` : base
  }

  async createJob(
    operation: Operation,
    opts: {
      query?: string
      columnDelimiter?: ColumnDelimiter
      lineEnding?: LineEnding
      externalIdField?: string | null
    } = {},
  ): Promise<JobInfo> {
    const isQuery = operation === Operation.query || operation === Operation.queryAll
    const payload: Record<string, unknown> = {
      operation,
      columnDelimiter: opts.columnDelimiter ?? ColumnDelimiter.COMMA,
      lineEnding: opts.lineEnding ?? LineEnding.LF,
    }

    let headers: Record<string, string>
    if (isQuery) {
      if (!opts.query) throw new Error('query string is required for query jobs')
      payload.query = opts.query
      headers = this._headers(JSON_CONTENT_TYPE, CSV_CONTENT_TYPE)
    } else {
      payload.object = this.objectName
      payload.contentType = 'CSV'
      if (opts.externalIdField) payload.externalIdFieldName = opts.externalIdField
      headers = this._headers()
    }

    const response = await this._http.request(http.post, this._url(null, isQuery), {
      headers,
      content: JSON.stringify(payload),
    })
    return (await response.json()) as JobInfo
  }

  /** Exponential backoff poll until JobComplete, Aborted, or Failed. */
  async waitForJob(jobId: string, isQuery: boolean, wait = 0.5): Promise<void> {
    const deadline = Date.now() + DEFAULT_WAIT_TIMEOUT_SECONDS * 1000
    let delay = 0.0
    let delayCnt = 0

    await sleep(wait)

    while (Date.now() < deadline) {
      const info = await this.getJob(jobId, isQuery)
      const state = info.state
      if (state === JobState.jobComplete) return
      if (state === JobState.aborted || state === JobState.failed) {
        throw new Error(
          `Job ${jobId} ended with state '${state}': ${info.errorMessage ?? JSON.stringify(info)}`,
        )
      }
      if (delay < MAX_CHECK_INTERVAL_SECONDS) {
        delay = wait + Math.exp(delayCnt) / 1000.0
        delayCnt += 1
      }
      await sleep(delay)
    }

    throw new Error(`Job ${jobId} timed out after ${DEFAULT_WAIT_TIMEOUT_SECONDS}s`)
  }

  async getJob(jobId: string, isQuery: boolean): Promise<JobInfo> {
    const response = await this._http.request(http.get, this._url(jobId, isQuery))
    return (await response.json()) as JobInfo
  }

  closeJob(jobId: string): Promise<JobInfo> {
    return this._setState(jobId, false, JobState.uploadComplete)
  }

  abortJob(jobId: string, isQuery: boolean): Promise<JobInfo> {
    return this._setState(jobId, isQuery, JobState.aborted)
  }

  async deleteJob(jobId: string, isQuery: boolean): Promise<JobInfo> {
    const response = await this._http.request(http.delete, this._url(jobId, isQuery))
    return (await response.json()) as JobInfo
  }

  private async _setState(jobId: string, isQuery: boolean, state: string): Promise<JobInfo> {
    const response = await this._http.request(http.patch, this._url(jobId, isQuery), {
      content: JSON.stringify({ state }),
    })
    return (await response.json()) as JobInfo
  }

  async uploadJobData(jobId: string, data: Buffer): Promise<void> {
    if (!data || data.length === 0) throw new Error('data is required for ingest jobs')
    if (data.length > MAX_INGEST_JOB_FILE_SIZE) {
      throw new Error(
        `Chunk is ${data.length} bytes - exceeds the ${MAX_INGEST_JOB_FILE_SIZE} byte Bulk 2.0 limit. ` +
          'Reduce chunkSize on the upload call.',
      )
    }
    const response = await this._http.request(http.put, this._url(jobId, false) + '/batches', {
      headers: this._headers(CSV_CONTENT_TYPE, JSON_CONTENT_TYPE),
      content: new Uint8Array(data),
    })
    if (response.status !== 201) {
      throw new Error(`Upload failed. HTTP ${response.status}: ${await response.text()}`)
    }
  }

  async getQueryResults(
    jobId: string,
    locator = '',
    maxRecords = DEFAULT_QUERY_PAGE_SIZE,
  ): Promise<{ locator: string; number_of_records: number; data: Buffer }> {
    const params: Record<string, string> = { maxRecords: String(maxRecords) }
    if (locator && locator !== 'null') params.locator = locator

    const response = await this._http.request(http.get, this._url(jobId, true) + '/results', {
      headers: this._headers(JSON_CONTENT_TYPE, CSV_CONTENT_TYPE),
      params,
    })

    let nextLocator = response.headers.get('Sforce-Locator') ?? ''
    if (nextLocator === 'null') nextLocator = ''

    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      locator: nextLocator,
      number_of_records: Number(response.headers.get('Sforce-NumberOfRecords') ?? 0),
      data: filterNullBytes(bytes),
    }
  }

  async getIngestResults(jobId: string, resultsType: string): Promise<Buffer> {
    const response = await this._http.request(http.get, this._url(jobId, false) + `/${resultsType}`, {
      headers: this._headers(JSON_CONTENT_TYPE, CSV_CONTENT_TYPE),
    })
    return filterNullBytes(Buffer.from(await response.arrayBuffer()))
  }
}
