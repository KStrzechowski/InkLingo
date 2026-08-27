import { type FastifyReply } from 'fastify'
import {
  BlankTextError,
  DuplicateSenseError,
  DuplicateSenseLanguageError,
  EmptyEntryError,
  LanguageAlreadyPresentError,
  LanguageNotTaughtError,
  SenseWithoutTranslationError,
  TranslationWithoutSentenceError
} from '../../../domain/errors.ts'

// The single translation site from the aggregate's error taxonomy to HTTP.
//
// Every branch is a `DomainError` subclass, so the set is closed and adding a
// rule to `Entry` without deciding its status code is a compile-time omission
// rather than a silent 500. Anything unrecognized is **rethrown** — not
// swallowed as a generic 400 — so `plugins/error-handler.ts:54-93` logs it with
// the correlation id a user can quote.
//
// The messages come from the errors themselves, and each was chosen in Phase 1
// to be the wording this route already returned: `LanguageNotTaughtError` says
// "language code is not one of the collection's target languages" and
// `LanguageAlreadyPresentError` says "this entry already has a translation in
// that language". Nothing parsing an error body has to change.
//
// Bodies are @fastify/sensible's, so the envelope (`statusCode` / `error` /
// `message`) is the same one every other failure in the app uses.

// 400 — the request asked for something that is not a well-formed entry.
const BAD_REQUEST_ERRORS = [
  BlankTextError,
  EmptyEntryError,
  SenseWithoutTranslationError,
  TranslationWithoutSentenceError,
  LanguageNotTaughtError
] as const

// 409 — the request is well-formed but collides with something that already
// exists, either inside the same payload or already in the entry.
const CONFLICT_ERRORS = [
  DuplicateSenseError,
  DuplicateSenseLanguageError,
  LanguageAlreadyPresentError
] as const

export function mapDomainError (err: unknown, reply: FastifyReply): FastifyReply {
  if (BAD_REQUEST_ERRORS.some((type) => err instanceof type)) {
    return reply.badRequest((err as Error).message)
  }
  if (CONFLICT_ERRORS.some((type) => err instanceof type)) {
    return reply.conflict((err as Error).message)
  }
  throw err
}
