import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up (pgm: MigrationBuilder): Promise<void> {
  pgm.createExtension('pgcrypto', { ifNotExists: true })

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    cognito_sub: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('collections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('collections', 'user_id')

  pgm.createTable('entries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    collection_id: {
      type: 'uuid',
      notNull: true,
      references: 'collections',
      onDelete: 'CASCADE'
    },
    word_or_phrase: { type: 'text', notNull: true },
    source_language_code: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('entries', 'collection_id')

  pgm.createTable('entry_translations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    entry_id: {
      type: 'uuid',
      notNull: true,
      references: 'entries',
      onDelete: 'CASCADE'
    },
    language_code: { type: 'text', notNull: true },
    meaning_text: { type: 'text', notNull: true }
  })
  pgm.addConstraint('entry_translations', 'entry_translations_entry_id_language_code_key', {
    unique: ['entry_id', 'language_code']
  })

  pgm.createTable('entry_sentences', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    entry_id: {
      type: 'uuid',
      notNull: true,
      references: 'entries',
      onDelete: 'CASCADE'
    },
    language_code: { type: 'text', notNull: true },
    sentence_text: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('entry_sentences', 'entry_id')
}

export async function down (pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('entry_sentences')
  pgm.dropTable('entry_translations')
  pgm.dropTable('entries')
  pgm.dropTable('collections')
  pgm.dropTable('users')
}
