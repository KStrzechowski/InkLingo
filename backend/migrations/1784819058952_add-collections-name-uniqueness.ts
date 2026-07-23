import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate'

export const shorthands: ColumnDefinitions | undefined = undefined

export async function up (pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex('collections', ['user_id', 'lower(name)'], {
    name: 'collections_user_id_lower_name_key',
    unique: true
  })
}

export async function down (pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('collections', ['user_id', 'lower(name)'], {
    name: 'collections_user_id_lower_name_key'
  })
}
