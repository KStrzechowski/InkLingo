import { expect, test } from '@playwright/test'
import type { Response } from '@playwright/test'
import { API_COLLECTIONS, seedSession } from './support/session'

const API_CLIENT_ERRORS = '**/api/client-errors'

interface DeliveredReport {
  eventId: string
  app: string
  name: string
  message: string
  routePath?: string
  occurredAt: string
}

// Risk #4 (context/foundation/test-plan.md §2): "An expired or invalid auth
// token is sent with a request and the failure surfaces as an opaque CORS error
// instead of a clean re-authentication prompt." Seeded from a real incident —
// lessons.md, 2026-08-04, `fix/auth-token-refresh`.
//
// Why this risk is here and not in frontend/test/: Phase 3 already unit-tests
// each piece with the others mocked — getFreshUser's renewal and dedupe, the
// interceptor's retry, AuthProvider's event subscriptions. What no jsdom test
// can show is that the assembled app agrees, and the chain this risk runs
// through is unusually indirect: the axios interceptor lives *outside* React,
// signals through the connectionIssue module (a plain listener set), which
// AuthProvider subscribes to, which finally renders the banner. Four boundaries,
// each individually covered, none of them proven to be wired to the next.
//
// Modeled on seed.spec.ts. Both scenarios are independent and order-free.

test('a blocked API response offers a fresh sign-in instead of failing silently', async ({ page }) => {
  const email = await seedSession(page)

  // The exact shape of the incident: API Gateway's authorizer rejects the token
  // at the edge with a 401 that carries no Access-Control-Allow-Origin, so the
  // browser blocks it and the client sees no response at all. route.abort()
  // reproduces that — a failed request with no status to read — which is also
  // indistinguishable from a dropped connection, by design of the browser's
  // security boundary (see src/auth/connectionIssue.ts).
  //
  // Aborting every attempt, not just the first, is load-bearing: the client
  // retries a safe request once before it concludes anything, so a handler that
  // failed only once would let the retry succeed and no banner would appear.
  await page.route(API_COLLECTIONS, async (route) => {
    await route.abort()
  })

  await page.goto('/')

  // The business outcome: the user is told the session may have ended and is
  // given the one action that fixes it. Without the wiring under test, the page
  // sits there looking signed in while every request underneath fails invisibly.
  const banner = page.getByRole('alert')
  await expect(banner).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Sign in again' })).toBeVisible()

  // Deliberately not a forced logout. The same evidence is consistent with the
  // user's own network dropping, so the signed-in shell has to stay up — a
  // regression that logged them out here would be just as wrong as one that
  // showed nothing.
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
})

test('a rejected token drops the session to the signed-out view', async ({ page }) => {
  const email = await seedSession(page)

  // The other half of the risk: a 401 that does reach the client. Unlike the
  // blocked case above there is nothing ambiguous about it, so the session is
  // dropped rather than merely flagged.
  await page.route(API_COLLECTIONS, async (route) => {
    await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
  })

  await page.goto('/')

  // removeUser() raises userUnloaded, which AuthProvider turns into the
  // logged-out view — the "clean re-authentication prompt" the risk asks for,
  // rather than a signed-in shell over an API that rejects every call.
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByText(`Signed in as ${email}`)).toBeHidden()
})

// The evidence half of the same risk, and the reason the client buffers at all.
//
// The incident this reproduces (lessons.md, 2026-08-04) was expensive because
// it left no trace: the failure was invisible to the server, since the request
// never reached it, and invisible to us, since the browser only said "CORS".
// The ingest route is authenticated like everything else under /api, so a
// client in this state cannot report at the moment it happens — it has to
// survive until a working session returns. This asserts exactly that, and it
// is the assertion that goes red if the buffer is ever replaced with a
// fire-and-forget POST.
test('a failure during a dead session is still delivered once the session recovers', async ({ page }) => {
  await seedSession(page)

  const delivered: DeliveredReport[] = []
  await page.route(API_CLIENT_ERRORS, async (route) => {
    const body = route.request().postDataJSON() as { reports: DeliveredReport[] }
    delivered.push(...body.reports)
    // Echo the ids back, as the real route does — the client drains exactly
    // what was acknowledged.
    await route.fulfill({ json: { accepted: body.reports.map((report) => report.eventId) } })
  })

  // Phase one: the session is unusable. Same shape as the first test — a
  // request blocked before any status can be read.
  await page.route(API_COLLECTIONS, async (route) => {
    await route.abort()
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toBeVisible()

  // Nothing could be delivered while the session was dead. If this is ever
  // non-empty, the reporter is posting into a route that cannot accept it.
  expect(delivered).toHaveLength(0)

  // Phase two: the session recovers. The next successful authenticated request
  // is what drains the buffer.
  await page.unroute(API_COLLECTIONS)
  await page.route(API_COLLECTIONS, async (route) => {
    await route.fulfill({ json: { collections: [] } })
  })

  // waitForResponse, not waitForRequest: the route handler above records the
  // batch as it fulfills, so waiting on the request alone would race the
  // recording.
  const delivery: Promise<Response> = page.waitForResponse(
    (response) => response.url().includes('/api/client-errors') && response.request().method() === 'POST'
  )
  await page.reload()
  await delivery

  // The business outcome: the failure that happened while nobody could see it
  // is now on the server, named, and timestamped when it actually occurred.
  expect(delivered.length).toBeGreaterThan(0)
  const report = delivered[0]
  expect(report.app).toBe('frontend')
  expect(report.routePath).toContain('/api/collections')
  // Not the delivery time — a report stamped on arrival would place the
  // incident minutes after it happened.
  expect(Date.parse(report.occurredAt)).toBeLessThanOrEqual(Date.now())
})
