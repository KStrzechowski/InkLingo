import { test } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TSchema } from '@sinclair/typebox'
import {
  collectionSummarySchema,
  collectionDetailResponseSchema,
  entryResponseSchema,
  translateResponseSchema
} from '../src/routes/api/collections/schemas.ts'

// C-01 (context/changes/refactor-opportunities/research.md, ranked #1): no
// guard anywhere compared frontend/src/api/collections.ts and
// extension/src/types.ts — both hand-copied wire shapes — against what the
// backend actually declares. This is the research's incremental-path step 3,
// "a contract test comparing the client declarations to the server schemas,
// modelled on route-reachability.test.ts". Same idiom as that test and
// route-ownership.test.ts: read the other app's source as plain text and
// set-compare, rather than importing a sibling app's TypeScript project
// (backend/test/tsconfig.json's `include` does not cover frontend/ or
// extension/, so nothing here can import them directly).
//
// Field NAMES only, not full shapes (optionality, nullability, arrays vs.
// scalars) — narrower than a real type check, but it catches the failure
// mode that has no guard at all today: a field renamed, added, or dropped on
// one side and not the other.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_COLLECTIONS_PATH = path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'collections.ts')
const EXTENSION_TYPES_PATH = path.join(__dirname, '..', '..', 'extension', 'src', 'types.ts')

const frontendSource = fs.readFileSync(FRONTEND_COLLECTIONS_PATH, 'utf8')
const extensionSource = fs.readFileSync(EXTENSION_TYPES_PATH, 'utf8')

// TypeBox schemas are plain objects at runtime — read their field names
// directly rather than re-parsing schemas.ts as text.
function fieldsOf (schema: TSchema): string[] {
  return Object.keys((schema as unknown as { properties: Record<string, unknown> }).properties).sort()
}

// Walks a chain of array-of-object fields (e.g. 'senses', 'translations') to
// the object schema at the end, then returns its field names.
function propsAt (root: TSchema, ...arrayFields: string[]): string[] {
  let node = root
  for (const field of arrayFields) {
    const properties = (node as unknown as { properties: Record<string, TSchema> }).properties
    node = (properties[field] as unknown as { items: TSchema }).items
  }
  return fieldsOf(node)
}

// Extracts a flat TS interface's own field names, merging in an `extends`
// base's fields. Only handles the flat shape (scalar / string[] /
// NamedType[] fields, no inline object literals) that both client files
// actually use — verified by reading both files before writing this.
function extractInterfaceFields (source: string, name: string): string[] {
  const header = new RegExp(`export interface ${name}(?:\\s+extends\\s+(\\w+))?\\s*\\{`).exec(source)
  assert.ok(header !== null, `interface ${name} not found in source`)
  const bodyStart = header.index + header[0].length
  const bodyEnd = source.indexOf('\n}', bodyStart)
  assert.ok(bodyEnd !== -1, `interface ${name}'s closing brace not found`)
  const body = source.slice(bodyStart, bodyEnd)

  const ownFields = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1])
  const baseName = header[1]
  const baseFields = baseName === undefined ? [] : extractInterfaceFields(source, baseName)
  return [...new Set([...ownFields, ...baseFields])].sort()
}

interface ContractCase {
  interfaceName: string
  source: string
  serverFields: string[]
}

const frontendCases: ContractCase[] = [
  { interfaceName: 'Collection', source: frontendSource, serverFields: fieldsOf(collectionSummarySchema) },
  { interfaceName: 'CollectionDetail', source: frontendSource, serverFields: fieldsOf(collectionDetailResponseSchema) },
  { interfaceName: 'Entry', source: frontendSource, serverFields: fieldsOf(entryResponseSchema) },
  { interfaceName: 'EntrySense', source: frontendSource, serverFields: propsAt(entryResponseSchema, 'senses') },
  { interfaceName: 'EntryTranslation', source: frontendSource, serverFields: propsAt(entryResponseSchema, 'senses', 'translations') },
  { interfaceName: 'EntrySentence', source: frontendSource, serverFields: propsAt(entryResponseSchema, 'senses', 'translations', 'sentences') }
]

const extensionCases: ContractCase[] = [
  { interfaceName: 'Collection', source: extensionSource, serverFields: fieldsOf(collectionSummarySchema) },
  { interfaceName: 'TranslationResult', source: extensionSource, serverFields: fieldsOf(translateResponseSchema) },
  { interfaceName: 'TranslationSense', source: extensionSource, serverFields: propsAt(translateResponseSchema, 'senses') },
  { interfaceName: 'SenseTranslation', source: extensionSource, serverFields: propsAt(translateResponseSchema, 'senses', 'translations') },
  { interfaceName: 'TranslationSentence', source: extensionSource, serverFields: propsAt(translateResponseSchema, 'senses', 'translations', 'sentences') },
  // SavedEntry types the POST /:id/entries response — entryResponseSchema,
  // same as the frontend's Entry/EntrySense/EntryTranslation/EntrySentence.
  { interfaceName: 'SavedEntry', source: extensionSource, serverFields: fieldsOf(entryResponseSchema) },
  { interfaceName: 'SavedEntrySense', source: extensionSource, serverFields: propsAt(entryResponseSchema, 'senses') },
  { interfaceName: 'SavedEntryTranslation', source: extensionSource, serverFields: propsAt(entryResponseSchema, 'senses', 'translations') },
  { interfaceName: 'SavedEntrySentence', source: extensionSource, serverFields: propsAt(entryResponseSchema, 'senses', 'translations', 'sentences') }
]

for (const { interfaceName, source, serverFields } of frontendCases) {
  test(`frontend/src/api/collections.ts's ${interfaceName} matches its backend response schema`, () => {
    assert.deepStrictEqual(extractInterfaceFields(source, interfaceName), serverFields)
  })
}

for (const { interfaceName, source, serverFields } of extensionCases) {
  test(`extension/src/types.ts's ${interfaceName} matches its backend response schema`, () => {
    assert.deepStrictEqual(extractInterfaceFields(source, interfaceName), serverFields)
  })
}
