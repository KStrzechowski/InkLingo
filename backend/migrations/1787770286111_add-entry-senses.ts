import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// WHY THIS MIGRATION USES `pgm.db.query` THROUGHOUT INSTEAD OF THE BUILDER
//
// node-pg-migrate's `pgm.createTable` / `pgm.addColumn` / ... do not execute:
// they push SQL onto `pgm._steps`, which the runner replays *after* the
// migration function resolves (`migration.ts` `_apply`). `pgm.db.query` runs
// immediately. Mixing the two would therefore run the entire TypeScript
// backfill loop below *before* `entry_senses` existed.
//
// This migration has to interleave DDL and a TypeScript loop — see the frozen
// `senseKeyAtMigrationTime` below for why the loop cannot be plain SQL — so it
// is written eagerly end to end. `pgm.db` is the same client the runner's
// outer BEGIN holds, so the whole thing is still one transaction.

// Frozen copy of senseKey() as of this migration. Deliberately NOT imported from
// src/domain/senseKey.ts: a migration must keep producing what it produced the day
// it ran, and IL-24 will redefine that function.
const senseKeyAtMigrationTime = (gloss: string): string => gloss.trim().toLowerCase()

export async function up (pgm: MigrationBuilder): Promise<void> {
  // 1. The meaning becomes a row.
  await pgm.db.query(`
    CREATE TABLE entry_senses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_id uuid NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
      gloss_text text NOT NULL,
      sense_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT entry_senses_entry_id_sense_key_key UNIQUE (entry_id, sense_key)
    )
  `)
  await pgm.db.query('CREATE INDEX entry_senses_entry_id_index ON entry_senses (entry_id)')

  // 2. The two pairings, nullable for now so the backfill has somewhere to write.
  await pgm.db.query(`
    ALTER TABLE entry_translations
      ADD COLUMN sense_id uuid REFERENCES entry_senses (id) ON DELETE CASCADE
  `)
  await pgm.db.query(`
    ALTER TABLE entry_sentences
      ADD COLUMN translation_id uuid REFERENCES entry_translations (id) ON DELETE CASCADE
  `)

  // 3. Backfill. Every existing entry has exactly one meaning — that is what
  //    UNIQUE(entry_id, language_code) guaranteed — so one entry_senses row per
  //    entry, not one per entry-language. `gloss_text` is the entry's own
  //    word_or_phrase: with a single meaning the native word *is* the meaning,
  //    and INV-7 guarantees it is already in the native language.
  const entries = await pgm.db.select(
    'SELECT id, word_or_phrase FROM entries ORDER BY id'
  ) as Array<{ id: string, word_or_phrase: string }>

  for (const entry of entries) {
    const senseRows = await pgm.db.select(
      'INSERT INTO entry_senses (entry_id, gloss_text, sense_key) VALUES ($1, $2, $3) RETURNING id',
      [entry.id, entry.word_or_phrase, senseKeyAtMigrationTime(entry.word_or_phrase)]
    ) as Array<{ id: string }>
    await pgm.db.query(
      'UPDATE entry_translations SET sense_id = $1 WHERE entry_id = $2',
      [senseRows[0].id, entry.id]
    )
  }
  console.log(`add-entry-senses: created ${entries.length} entry_senses row(s)`)

  // Sentences find their translation by (entry_id, lower(language_code)) —
  // lower() because legacy rows hold 'PL'/'EN'. Phase 0 measured zero ambiguous
  // matches (research.md § 4), so this join picks exactly one row or none.
  const paired = await pgm.db.query(`
    UPDATE entry_sentences s
       SET translation_id = t.id
      FROM entry_translations t
     WHERE t.entry_id = s.entry_id
       AND lower(t.language_code) = lower(s.language_code)
  `)
  console.log(`add-entry-senses: paired ${paired.rowCount ?? 0} sentence(s) to a translation`)

  // 4. Repair the rows the aggregate rejects. Each DELETE is a predicate over
  //    the *condition*, never over specific ids, so it is a no-op wherever the
  //    data is already clean — this migration also runs against environments
  //    Phase 0 never probed.
  //
  //    Order matters and differs from the plan's prose listing: deleting a
  //    null-gloss sentence can leave its translation with no sentence at all, so
  //    the sentence-less-translation sweep must run last or it misses those.
  //    The set of rows removed is the same either way; only the per-step
  //    attribution shifts (see the note under Phase 3 manual verification).
  const orphans = await pgm.db.query(
    'DELETE FROM entry_sentences WHERE translation_id IS NULL'
  )
  console.log(`add-entry-senses: deleted ${orphans.rowCount ?? 0} orphan sentence(s)`)

  // § 4.3 requires both halves of a sentence non-blank; a NULL native gloss is
  // a BlankTextError('sentence') on read.
  const nullGloss = await pgm.db.query(
    "DELETE FROM entry_sentences WHERE native_gloss_text IS NULL OR btrim(native_gloss_text) = ''"
  )
  console.log(`add-entry-senses: deleted ${nullGloss.rowCount ?? 0} sentence(s) with no native gloss`)

  // A word with no sentence is TranslationWithoutSentenceError.
  const sentenceless = await pgm.db.query(`
    DELETE FROM entry_translations t
     WHERE NOT EXISTS (SELECT 1 FROM entry_sentences s WHERE s.translation_id = t.id)
  `)
  console.log(`add-entry-senses: deleted ${sentenceless.rowCount ?? 0} sentence-less translation(s)`)

  // 5. Lock the pairings in.
  await pgm.db.query('ALTER TABLE entry_translations ALTER COLUMN sense_id SET NOT NULL')
  await pgm.db.query('ALTER TABLE entry_sentences ALTER COLUMN translation_id SET NOT NULL')

  // 6. Move the uniqueness rule down one level. This is the constraint that
  //    physically forbade `zamek` from being both a castle and a lock.
  await pgm.db.query(`
    ALTER TABLE entry_translations
      DROP CONSTRAINT entry_translations_entry_id_language_code_key
  `)
  await pgm.db.query(`
    ALTER TABLE entry_translations
      ADD CONSTRAINT entry_translations_sense_id_language_code_key UNIQUE (sense_id, language_code)
  `)

  // Dropping that constraint drops the only index led by entry_id, and three
  // live paths read on it: the collection-detail read, the FR-018 conflict
  // check, and the ON DELETE CASCADE sweep. Re-add it explicitly.
  await pgm.db.query('CREATE INDEX entry_translations_entry_id_index ON entry_translations (entry_id)')
  await pgm.db.query('CREATE INDEX entry_sentences_translation_id_index ON entry_sentences (translation_id)')
}

// ONE-WAY DOOR. `down()` re-adds UNIQUE(entry_id, language_code), which fails
// the first time any entry holds two senses sharing a target language — i.e.
// the first real use of the feature this migration exists to enable. It is
// rehearsable exactly once, against pre-refactor data, and never again.
export async function down (pgm: MigrationBuilder): Promise<void> {
  await pgm.db.query('DROP INDEX IF EXISTS entry_sentences_translation_id_index')
  await pgm.db.query('DROP INDEX IF EXISTS entry_translations_entry_id_index')
  await pgm.db.query(`
    ALTER TABLE entry_translations
      DROP CONSTRAINT entry_translations_sense_id_language_code_key
  `)
  await pgm.db.query(`
    ALTER TABLE entry_translations
      ADD CONSTRAINT entry_translations_entry_id_language_code_key UNIQUE (entry_id, language_code)
  `)
  await pgm.db.query('ALTER TABLE entry_sentences DROP COLUMN translation_id')
  await pgm.db.query('ALTER TABLE entry_translations DROP COLUMN sense_id')
  await pgm.db.query('DROP TABLE entry_senses')
}
