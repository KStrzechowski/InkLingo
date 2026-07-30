import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up (pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('collections', {
    native_language_code: { type: 'text', notNull: true }
  })

  pgm.createTable('collection_target_languages', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    collection_id: {
      type: 'uuid',
      notNull: true,
      references: 'collections',
      onDelete: 'CASCADE'
    },
    language_code: { type: 'text', notNull: true }
  })
  pgm.addConstraint('collection_target_languages', 'collection_target_languages_collection_id_language_code_key', {
    unique: ['collection_id', 'language_code']
  })
  pgm.createIndex('collection_target_languages', 'collection_id')
}

export async function down (pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('collection_target_languages')
  pgm.dropColumn('collections', 'native_language_code')
}
