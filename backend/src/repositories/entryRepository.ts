import { type FastifyInstance } from 'fastify'
import { Entry, type EntryDraft, type SenseDraft, type SenseTranslationDraft, type SentenceDraft } from '../domain/entry.ts'
import { LanguageContract } from '../domain/languageContract.ts'
import { type Sense, type SenseTranslation } from '../domain/sense.ts'
import { type OwnedCollectionRow } from '../routes/api/collections/ownership.ts'
// Type-only import, erased at runtime. `Sql` below is `FastifyInstance['sql']`,
// which only exists because of fastify.d.ts's ambient augmentation — and
// nothing imports a .d.ts, so ts-node/esm's per-file checking may not have
// loaded it yet when this file is checked. Every file reading an augmented
// property needs its own (context/foundation/lessons.md — the trap this repo
// has hit three times, most recently when renaming a plugin changed the
// autoload sort order and a route nobody had touched started failing 9 of 127
// tests non-deterministically).
import type { AuthUser as _AuthUser } from '../fastify.d.ts'

// The only place SQL knows about the aggregate.
//
// Two rules hold everywhere below:
//
//  1. **Ownership is not this file's job.** `loadEntry` / `loadEntries` take a
//     contract built from a collection the caller has already proved the
//     requester owns. Beyond being the correct layering,
//     `test/route-ownership.test.ts` greps each route's own source slice for
//     the literal `fetchOwnedCollection(` / `fetchOwnedEntry(` — a repository
//     that "tidied up" by fetching them here would turn that test red while
//     being no safer.
//  2. **Reads go through the same strict constructor as writes** (decision A1).
//     There is no lenient reconstruction path: `Entry.capture` is the only way
//     to make an `Entry`, so a row that would violate an invariant fails loudly
//     on a plain `GET` instead of quietly rendering wrong. Phase 3's migration
//     repaired the handful of legacy rows that would otherwise throw here.

type Sql = FastifyInstance['sql']
type Statement = ReturnType<Sql>

interface EntryRow {
  id: string
  word_or_phrase: string
  source_language_code: string
  created_at: string | Date
}

interface SenseRow {
  id: string
  entry_id: string
  gloss_text: string
}

interface TranslationRow {
  id: string
  sense_id: string
  language_code: string
  meaning_text: string
  phonetic_transcription: string | null
}

interface SentenceRow {
  id: string
  translation_id: string
  sentence_text: string
  native_gloss_text: string
}

// --- the language contract --------------------------------------------------

// Pure half, for callers that already hold the collection's target codes and
// should not pay for a second query to get them — the collection-detail read
// needs those codes for its own response anyway, and returns them exactly as
// stored rather than as the contract normalizes them.
export function contractFor (collection: OwnedCollectionRow, targetLanguageCodes: readonly string[]): LanguageContract {
  return LanguageContract.of(collection.id, collection.native_language_code, targetLanguageCodes)
}

export async function loadContract (sql: Sql, collection: OwnedCollectionRow): Promise<LanguageContract> {
  const rows = await sql`
    SELECT language_code
    FROM collection_target_languages
    WHERE collection_id = ${collection.id}
  ` as Array<{ language_code: string }>
  return contractFor(collection, rows.map((row) => row.language_code))
}

// --- reads ------------------------------------------------------------------

// Four queries regardless of how many entries a collection holds — the shape
// `GET /:id` already used, one level deeper. `entry_translations.entry_id` and
// `entry_sentences.entry_id` are redundant next to their parent reference, and
// this is why they are kept: the whole aggregate reads in a fixed number of
// round trips, and the delete cascade stays one hop.
//
// ORDER. Every sense of one entry is inserted inside a single transaction, so
// they all share one `now()` and `created_at` cannot separate them — the `id`
// tiebreak below is what makes the sequence stable, not meaningful. A read
// therefore returns an entry's meanings in a fixed but arbitrary order, which
// is not the order they were saved in. Nothing depends on it today; Phase 6's
// print grouping is the first thing that might, and it needs a real position
// column rather than a different ORDER BY.
async function reconstruct (sql: Sql, contract: LanguageContract, entryRows: EntryRow[]): Promise<Entry[]> {
  if (entryRows.length === 0) return []
  const entryIds = entryRows.map((row) => row.id)

  const senseRows = await sql`
    SELECT id, entry_id, gloss_text
    FROM entry_senses
    WHERE entry_id = ANY(${entryIds})
    ORDER BY created_at ASC, id ASC
  ` as SenseRow[]
  const translationRows = await sql`
    SELECT id, sense_id, language_code, meaning_text, phonetic_transcription
    FROM entry_translations
    WHERE entry_id = ANY(${entryIds})
    ORDER BY language_code ASC, id ASC
  ` as TranslationRow[]
  const sentenceRows = await sql`
    SELECT id, translation_id, sentence_text, native_gloss_text
    FROM entry_sentences
    WHERE entry_id = ANY(${entryIds})
    ORDER BY created_at ASC, id ASC
  ` as SentenceRow[]

  return entryRows.map((entryRow) => {
    const senses: SenseDraft[] = senseRows
      .filter((sense) => sense.entry_id === entryRow.id)
      .map((sense) => ({
        id: sense.id,
        glossText: sense.gloss_text,
        translations: translationRows
          .filter((translation) => translation.sense_id === sense.id)
          .map((translation): SenseTranslationDraft => ({
            id: translation.id,
            languageCode: translation.language_code,
            meaningText: translation.meaning_text,
            phoneticTranscription: translation.phonetic_transcription,
            sentences: sentenceRows
              .filter((sentence) => sentence.translation_id === translation.id)
              .map((sentence): SentenceDraft => ({
                id: sentence.id,
                // `targetText` is the domain's name for the sentence in the
                // target language; `sentence_text` is the column's. The two
                // meet here and in `Entry.toResponse`, nowhere else.
                targetText: sentence.sentence_text,
                nativeGlossText: sentence.native_gloss_text
              }))
          }))
      }))

    const draft: EntryDraft = {
      id: entryRow.id,
      createdAt: new Date(entryRow.created_at),
      wordOrPhrase: entryRow.word_or_phrase,
      senses
    }
    return Entry.capture(contract, draft)
  })
}

export async function loadEntries (sql: Sql, contract: LanguageContract): Promise<Entry[]> {
  const entryRows = await sql`
    SELECT id, word_or_phrase, source_language_code, created_at
    FROM entries
    WHERE collection_id = ${contract.collectionId}
    ORDER BY created_at DESC
  ` as EntryRow[]
  return await reconstruct(sql, contract, entryRows)
}

// The collection id comes off the contract rather than a separate parameter, so
// an entry cannot be loaded against a contract belonging to another collection.
export async function loadEntry (sql: Sql, contract: LanguageContract, entryId: string): Promise<Entry | undefined> {
  const entryRows = await sql`
    SELECT id, word_or_phrase, source_language_code, created_at
    FROM entries
    WHERE id = ${entryId} AND collection_id = ${contract.collectionId}
  ` as EntryRow[]
  const [entry] = await reconstruct(sql, contract, entryRows)
  return entry
}

// --- writes -----------------------------------------------------------------

// One transaction, three levels deep, parent-first so every FK is satisfied
// inside it. The ids are the aggregate's own: the Neon HTTP driver runs only
// *non-interactive* transactions, so no `RETURNING` value can feed the next
// statement, and app-side ids are what make the whole nesting one round trip.
//
// Atomicity is the driver's, not ours — a statement that fails takes the whole
// array with it. That is the database half of design test 15; the aggregate
// refusing to be constructed at all is the other half, and it is the one that
// actually fires, since `Entry.capture` rejects the payload before a single
// statement is built.
export async function insertEntry (sql: Sql, entry: Entry): Promise<void> {
  const statements: Statement[] = [
    sql`
      INSERT INTO entries (id, collection_id, word_or_phrase, source_language_code, created_at)
      VALUES (${entry.id}, ${entry.collectionId}, ${entry.wordOrPhrase}, ${entry.sourceLanguageCode}, ${entry.createdAt.toISOString()})
    `
  ]

  for (const sense of entry.senses) {
    statements.push(sql`
      INSERT INTO entry_senses (id, entry_id, gloss_text, sense_key)
      VALUES (${sense.id}, ${entry.id}, ${sense.glossText}, ${sense.senseKey})
    `)
    for (const translation of sense.translations) {
      statements.push(...translationStatements(sql, entry, sense, translation))
    }
  }

  await sql.transaction(statements)
}

// FR-018's write half. Only the senses named by `senseIds` gained a word — a
// sparse spoke that already had one in this language must not be re-inserted,
// which is why the caller (who computed `sensesMissing` before spending a model
// call on each) names them rather than this function re-deriving them from the
// already-mutated aggregate.
export async function appendLanguage (
  sql: Sql,
  entry: Entry,
  languageCode: string,
  senseIds: ReadonlySet<string>
): Promise<void> {
  const code = languageCode.trim().toLowerCase()
  const statements: Statement[] = []

  for (const sense of entry.senses) {
    if (!senseIds.has(sense.id)) continue
    const translation = sense.translationFor(code)
    if (translation === undefined) continue
    statements.push(...translationStatements(sql, entry, sense, translation))
  }

  if (statements.length === 0) return
  await sql.transaction(statements)
}

function translationStatements (sql: Sql, entry: Entry, sense: Sense, translation: SenseTranslation): Statement[] {
  // `entry_sentences.language_code` is still NOT NULL and is written from the
  // parent translation, never from anything a client sent — so the cross-wired
  // sentence INV-12 exists to catch cannot be produced even by a bug here. The
  // column is dead weight from this phase on and Phase 7 drops it.
  return [
    sql`
      INSERT INTO entry_translations (id, entry_id, sense_id, language_code, meaning_text, phonetic_transcription)
      VALUES (${translation.id}, ${entry.id}, ${sense.id}, ${translation.languageCode}, ${translation.meaningText}, ${translation.phoneticTranscription})
    `,
    ...translation.sentences.map((sentence) => sql`
      INSERT INTO entry_sentences (id, entry_id, translation_id, language_code, sentence_text, native_gloss_text)
      VALUES (${sentence.id}, ${entry.id}, ${translation.id}, ${translation.languageCode}, ${sentence.targetText}, ${sentence.nativeGlossText})
    `)
  ]
}
