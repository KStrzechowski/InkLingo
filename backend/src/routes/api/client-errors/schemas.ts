import { Type, type Static } from '@sinclair/typebox'

// Batched so a client that buffered several reports while offline drains them
// in one request instead of a burst that trips its own rate limit.
export const MAX_REPORTS_PER_BATCH = 20

export const clientErrorReportSchema = Type.Object({
  // Client-generated, and the unit of acknowledgement: the response echoes the
  // ids that were durably logged, and the client drains exactly those. A
  // partial acceptance is therefore safe — the rest stay buffered.
  eventId: Type.String({ minLength: 1, maxLength: 64 }),
  app: Type.Union([Type.Literal('frontend'), Type.Literal('extension')]),
  appVersion: Type.String({ minLength: 1, maxLength: 40 }),
  // When the failure happened, not when it was delivered — a buffered report
  // flushed after re-authentication would otherwise be timestamped minutes
  // late, which is exactly the case this field exists for.
  occurredAt: Type.String({ format: 'date-time' }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  message: Type.String({ minLength: 1, maxLength: 1000 }),
  stack: Type.Optional(Type.String({ maxLength: 8000 })),
  routePath: Type.Optional(Type.String({ maxLength: 300 })),
  // The backend correlation id, when the failure came from a response that
  // carried one (x-request-id). Absent for a blocked request, which is the
  // whole reason the client-side report exists.
  requestId: Type.Optional(Type.String({ maxLength: 64 })),
  request: Type.Optional(Type.Object({
    method: Type.Optional(Type.String({ maxLength: 10 })),
    status: Type.Optional(Type.Integer()),
    // Key names only. See redact.ts for what the server does and does not
    // guarantee about this field.
    bodyKeys: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 100 }))
  }, { additionalProperties: false }))
}, { additionalProperties: false })

export type ClientErrorReport = Static<typeof clientErrorReportSchema>

export const clientErrorsBodySchema = Type.Object({
  reports: Type.Array(clientErrorReportSchema, { minItems: 1, maxItems: MAX_REPORTS_PER_BATCH })
})

export type ClientErrorsBody = Static<typeof clientErrorsBodySchema>
