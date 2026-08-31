import { expect, test } from '@playwright/test'
import { API_COLLECTION_DETAIL, seedSession } from './support/session'

// The print route's assembly, which nothing else covers.
//
// Read this against the print suite next door: frontend/browser-tests/ proves
// the printable *document* is correct — A4 geometry, print-media colour, column
// widths, page count — by mounting PrintDocument directly onto a static harness
// with committed fixtures, in two engines. What it cannot show is that a user
// can ever reach that document, because it never loads the app: no router, no
// auth gate, no fetch.
//
// Everything between the route and the document is unit-tested in isolation
// (printRows, printPagination, printLabels, printDocumentEffects) and assembled
// nowhere. These two specs cover exactly that seam — PrintLayout's auth gate,
// the :id param, the fetch lifecycle, and the handoff into PrintDocument.
//
// Assertions stay on structure the frontend derives (a heading from the
// collection's name, a row header per entry), never on the column labels: those
// are copy, and pinning copy makes a test about wording rather than behaviour.

const NATIVE_LANGUAGE = 'en'

function buildCollection (id: string, name: string) {
  return {
    id,
    name,
    nativeLanguageCode: NATIVE_LANGUAGE,
    targetLanguageCodes: ['pl', 'de'],
    createdAt: '2026-08-12T10:00:00.000Z',
    entries: [
      {
        id: `${id}-entry-1`,
        wordOrPhrase: 'threshold',
        sourceLanguageCode: NATIVE_LANGUAGE,
        createdAt: '2026-08-12T10:01:00.000Z',
        senses: [
          {
            id: `${id}-sense-1`,
            // Deliberately distinct from `wordOrPhrase` above. D-1's row-group
            // gloss header (`PrintDocument.tsx`) is also a `<th scope="rowgroup">`,
            // which the ARIA→HTML mapping exposes under the same `rowheader`
            // role as the word column's `<th scope="row">` — a gloss that
            // repeats the word text makes `getByRole('rowheader', { name:
            // 'threshold' })` match both columns and fail Playwright's strict
            // mode, which is exactly what happened here before this fixture
            // was written to avoid it.
            glossText: 'the sill of a doorway',
            translations: [
              {
                id: `${id}-t1`,
                languageCode: 'pl',
                meaningText: 'próg',
                phoneticTranscription: 'pruk',
                sentences: [
                  {
                    id: `${id}-s1`,
                    // Deliberately does not repeat the translation text: a
                    // sentence containing 'próg' makes the cell assertion
                    // below ambiguous, and loosening the locator to resolve
                    // that would weaken the test.
                    sentenceText: 'Weszliśmy do środka.',
                    nativeGlossText: 'We stepped inside.'
                  }
                ]
              },
              {
                id: `${id}-t2`,
                languageCode: 'de',
                meaningText: 'Schwelle',
                phoneticTranscription: null,
                sentences: [
                  {
                    id: `${id}-s2`,
                    // Same reasoning as the Polish sentence above: repeating
                    // 'Schwelle' here made the cell assertion below ambiguous
                    // against the meaning cell's own 'Schwelle' text — added
                    // when this fixture gained sentences (invariant-aggregate
                    // -refactor p6) without carrying that constraint forward.
                    sentenceText: 'Wir traten vorsichtig hinein.',
                    nativeGlossText: 'We stepped in carefully.'
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

test('the print route renders a printable document for a signed-in user', async ({ page }) => {
  await seedSession(page)

  // Unique per run so parallel workers never assert on each other's document.
  const id = `print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const name = `Print Route ${id}`

  await page.route(API_COLLECTION_DETAIL, async (route) => {
    await route.fulfill({ json: buildCollection(id, name) })
  })

  await page.goto(`/collections/${id}/print`)

  // The document itself: the collection's own name as the sheet heading, and
  // the entry reachable as a row header. If the fetch, the param, or the handoff
  // into PrintDocument breaks, this is what stops being true — while every unit
  // test around it stays green.
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'threshold' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'próg' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Schwelle' })).toBeVisible()

  // PrintLayout deliberately renders none of the app chrome, because the
  // on-screen preview has to match what actually prints.
  await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden()
})

test('the print route stays behind the auth gate', async ({ page }) => {
  // No seeded session. PrintLayout carries its own copy of the auth gate — the
  // shared AuthenticatedLayout does not wrap this route — so a regression there
  // would expose the print view to an unauthenticated visitor while every other
  // page stayed correctly gated.
  const id = `print-gate-${Date.now()}`

  await page.goto(`/collections/${id}/print`)

  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('table')).toBeHidden()
})
