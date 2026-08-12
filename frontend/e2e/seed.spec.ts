import { expect, test } from '@playwright/test'
import { API_COLLECTIONS, seedSession } from './support/session'

// The exemplar for this suite. Every spec in frontend/e2e/ is modeled on it, so
// what it demonstrates is what gets generated: role-based locators, a session
// seeded instead of driven through the hosted UI, web-first assertions rather
// than sleeps, and one self-contained test that could run alone, in parallel,
// in any order.
//
// It also carries its weight as a test: a session surviving a reload is the
// precondition every other spec here assumes, so if this goes red the failures
// elsewhere are noise.

test('a signed-in session survives a page reload', async ({ page }) => {
  const email = await seedSession(page)

  // Stub the transport, keep the app real. An empty list is the one response
  // that asserts nothing about backend behaviour — this spec is about the auth
  // shell, not about collections.
  await page.route(API_COLLECTIONS, async (route) => {
    await route.fulfill({ json: { collections: [] } })
  })

  await page.goto('/')

  // Web-first assertions retry until the condition holds, which is what
  // replaces waiting for a duration: AuthProvider resolves getFreshUser()
  // asynchronously, so the shell appears a tick after navigation.
  await expect(page.getByRole('heading', { name: 'InkLingo' })).toBeVisible()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

  await page.reload()

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

  // No cleanup block, and that is deliberate rather than an omission: each test
  // gets a fresh browser context, so the seeded session dies with it, and the
  // backend is stubbed so nothing was ever persisted. A spec that creates real
  // server-side data does need an afterEach that removes it — see E2E-RULES.md.
})
