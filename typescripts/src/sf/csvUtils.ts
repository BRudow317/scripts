/**
 * csvUtils.ts
 *
 * CSV helpers for Salesforce Bulk API 2.0, ported from src/sf/csv_utils.py.
 * Python relied on the stdlib `csv` module (DictWriter/DictReader); Node has no
 * built-in CSV, so this provides an RFC 4180 writer and parser covering the two
 * directions Bulk 2.0 needs: serialize records to ingest, parse query-result
 * pages. https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/datafiles_prepare_csv.htm
 */

export const ColumnDelimiter = {
  BACKQUOTE: 'BACKQUOTE',
  CARET: 'CARET',
  COMMA: 'COMMA',
  PIPE: 'PIPE',
  SEMICOLON: 'SEMICOLON',
  TAB: 'TAB',
} as const
export type ColumnDelimiter = (typeof ColumnDelimiter)[keyof typeof ColumnDelimiter]

export const DELIMITERS: Record<ColumnDelimiter, string> = {
  BACKQUOTE: '`',
  CARET: '^',
  COMMA: ',',
  PIPE: '|',
  SEMICOLON: ';',
  TAB: '\t',
}

export const LineEnding = {
  LF: 'LF',
  CRLF: 'CRLF',
} as const
export type LineEnding = (typeof LineEnding)[keyof typeof LineEnding]

export const LINE_ENDINGS: Record<LineEnding, string> = { LF: '\n', CRLF: '\r\n' }

function escapeField(value: unknown, delimiter: string): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Serialize records to a CSV string. Mirrors charon's _records_to_csv_bytes:
 * the header is the order-preserving union of all keys (prepare_record omits
 * null fields, so rows can differ), and extra keys not in the header are dropped.
 */
export function recordsToCsv(
  records: Record<string, unknown>[],
  lineEnding: LineEnding = LineEnding.LF,
  includeHeader = true,
  columnDelimiter: ColumnDelimiter = ColumnDelimiter.COMMA,
): string {
  if (records.length === 0) return ''
  const dl = DELIMITERS[columnDelimiter]
  const le = LINE_ENDINGS[lineEnding]

  const fieldnames: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    for (const k of Object.keys(record)) {
      if (!seen.has(k)) {
        seen.add(k)
        fieldnames.push(k)
      }
    }
  }

  const lines: string[] = []
  if (includeHeader) {
    lines.push(fieldnames.map((f) => escapeField(f, dl)).join(dl))
  }
  for (const record of records) {
    lines.push(fieldnames.map((f) => escapeField(record[f], dl)).join(dl))
  }
  return lines.join(le) + le
}

/** Encode records as CSV bytes for Bulk 2.0 upload. */
export function recordsToCsvBytes(
  records: Record<string, unknown>[],
  lineEnding: LineEnding = LineEnding.LF,
  includeHeader = true,
  columnDelimiter: ColumnDelimiter = ColumnDelimiter.COMMA,
): Buffer {
  return Buffer.from(recordsToCsv(records, lineEnding, includeHeader, columnDelimiter), 'utf-8')
}

/**
 * Parse CSV text into an array of records keyed by header (DictReader
 * equivalent). Handles quoted fields with embedded delimiters, newlines, and
 * doubled quotes. Assumes the comma delimiter used by Bulk 2.0 query results.
 */
export function parseCsv(text: string, delimiter = ','): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      // Swallow CR; the LF (or end) finalizes the row.
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  // Flush trailing field/row if the text didn't end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  if (rows.length === 0) return []
  const header = rows[0]
  const records: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    const record: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) {
      record[header[c]] = rows[r][c] ?? ''
    }
    records.push(record)
  }
  return records
}
