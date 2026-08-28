import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// `entry_sentences.language_code` has been dead weight since Phase 4 of
// invariant-aggregate-refactor: a sentence's language is its translation's
// (`entry_sentences.translation_id -> entry_translations.language_code`), and
// nothing under `backend/src` has read this column since the repository
// stopped needing it. It was still written on every insert, purely because
// the column stayed NOT NULL — this migration is what finally lets it go.

export async function up (pgm: MigrationBuilder): Promise<void> {
  await pgm.db.query('ALTER TABLE entry_sentences DROP COLUMN language_code')
}

// Re-added nullable, then backfilled from the sentence's own translation —
// the same join the Phase 3 migration used to pair sentences to translations
// in the first place, now run in the opposite direction. Nullable rather than
// NOT NULL: a sentence inserted after `up()` never populated this column, so
// enforcing NOT NULL on the way back down would be asserting data that was
// never collected.
export async function down (pgm: MigrationBuilder): Promise<void> {
  await pgm.db.query('ALTER TABLE entry_sentences ADD COLUMN language_code text')
  await pgm.db.query(`
    UPDATE entry_sentences s
       SET language_code = t.language_code
      FROM entry_translations t
     WHERE t.id = s.translation_id
  `)
}
