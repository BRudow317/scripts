/**
 * SfModels.ts
 *
 * Salesforce constants and the request-error type, ported from
 * src/sf/SfModels.py.
 */

export const HttpMethod = {
  delete: 'DELETE',
  get: 'GET',
  head: 'HEAD',
  options: 'OPTIONS',
  patch: 'PATCH',
  post: 'POST',
  put: 'PUT',
  request: 'REQUEST',
} as const
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod]

export const Operation = {
  insert: 'insert',
  upsert: 'upsert',
  update: 'update',
  delete: 'delete',
  hardDelete: 'hardDelete',
  query: 'query',
  queryAll: 'queryAll',
} as const
export type Operation = (typeof Operation)[keyof typeof Operation]

// Salesforce errorCodes meaning the user lacks rights (skippable per-table
// during a bulk migration rather than fatal).
export const SF_ACCESS_ERROR_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_ACCESS',
  'INSUFFICIENT_ACCESS_OR_READONLY',
  'INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY',
])

// Objects excluded from migratable describe.
export const SKIP_SUFFIXES = [
  '__History',
  '__Feed',
  '__Share',
  '__Tag',
  '__ChangeEvent',
  '__e',
  '__mdt',
  '__b',
] as const

export const SKIP_NAMES: ReadonlySet<string> = new Set([
  // Feeds
  'AccountFeed', 'ContactFeed', 'CaseFeed', 'LeadFeed',
  'OpportunityFeed', 'UserFeed', 'CollaborationGroupFeed',
  // History
  'AccountHistory', 'ContactHistory', 'CaseHistory', 'LeadHistory',
  'OpportunityHistory', 'OpportunityFieldHistory',
  // Shares
  'AccountShare', 'CaseShare', 'LeadShare', 'OpportunityShare',
  // Apex / Dev
  'ApexClass', 'ApexTrigger', 'ApexLog', 'ApexTestResult',
  'AsyncApexJob', 'CronTrigger', 'CronJobDetail',
  // Content (binary blobs - break bulk migrations)
  'ContentVersion', 'ContentDocument', 'ContentDocumentLink',
  // Restricted query syntax
  'ContentFolderItem', 'IdeaComment',
  // Metadata / Definitions
  'EntityDefinition', 'FieldDefinition', 'FieldPermissions',
  // Auth / Sessions
  'OauthToken', 'AuthSession', 'SessionPermSetActivation',
  'TwoFactorInfo', 'VerificationHistory', 'LoginHistory', 'LoginGeo',
  // Platform
  'StaticResource', 'AuraDefinition', 'AuraDefinitionBundle',
  'FlowDefinitionView', 'FlowInterview', 'PlatformEventChannel',
  'PlatformEventChannelMember', 'DataStatistics', 'BackgroundOperation',
  'SetupAuditTrail',
  // Permissions
  'PermissionSet', 'PermissionSetAssignment', 'GroupMember',
  'UserRole', 'UserLicense',
])

/**
 * Raised when the Salesforce REST API returns a non-2xx response. Parses the
 * response body for Salesforce errorCode(s) so callers can react to specific
 * failures (e.g. skipping a table on INSUFFICIENT_ACCESS).
 */
export class SalesforceRequestError extends Error {
  statusCode: number
  method: string
  url: string
  body: string
  errorCodes: string[]

  constructor(statusCode: number, method: unknown, url: unknown, body: string) {
    super(`HTTP ${statusCode} ${String(method)} ${String(url)}: ${body}`)
    this.name = 'SalesforceRequestError'
    this.statusCode = statusCode
    this.method = String(method)
    this.url = String(url)
    this.body = body
    this.errorCodes = SalesforceRequestError._parseErrorCodes(body)
  }

  private static _parseErrorCodes(body: string): string[] {
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return []
    }
    const list = Array.isArray(payload) ? payload : [payload]
    const codes: string[] = []
    for (const item of list) {
      if (item && typeof item === 'object' && 'errorCode' in item) {
        const code = (item as { errorCode?: unknown }).errorCode
        if (code) codes.push(String(code))
      }
    }
    return codes
  }

  /** True when the failure is an access-rights denial (skippable). */
  get isAccessError(): boolean {
    return this.errorCodes.some((code) => SF_ACCESS_ERROR_CODES.has(code))
  }
}
