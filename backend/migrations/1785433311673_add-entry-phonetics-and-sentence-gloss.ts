import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

// Both columns are nullable on purpose: they hold best-effort generation
// output (an IPA transcription isn't always producible for a given
// variant), even though the save endpoint always sends whatever it got.
export async function up (pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('entry_translations', {
    phonetic_transcription: { type: 'text' }
  })

  pgm.addColumn('entry_sentences', {
    native_gloss_text: { type: 'text' }
  })
}

export async function down (pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn('entry_sentences', 'native_gloss_text')
  pgm.dropColumn('entry_translations', 'phonetic_transcription')
}
