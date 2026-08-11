import type { Page } from '@playwright/test'

export function harnessUrl (fixture: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ fixture, ...params })
  return `/print-harness.html?${query.toString()}`
}

// The on-screen preview: sheets drawn at real 210 x 297mm with the same
// margins @page uses, which is the geometry the printed sheet actually has.
//
// Anything measuring the sheet's layout must use this rather than print
// emulation. Under `media: 'print'` the sheet collapses to a plain block
// (`.print-page { width: auto; padding: 0 }`) because @page supplies the
// geometry instead — so the table spans the viewport, and a column measured
// there is roughly twice its width on paper.
export async function openPreview (page: Page, fixture: string, params: Record<string, string> = {}): Promise<void> {
  await page.goto(harnessUrl(fixture, params))
  await page.locator('.print-page').first().waitFor()
}

// Media emulation is set BEFORE navigation on purpose. Firefox does not apply a
// colorScheme change to an already-loaded page without a reload
// (microsoft/playwright#2352), so a test that navigates first and emulates
// after passes in Chromium while silently asserting light-mode values in
// Firefox — the exact half of Risk #2 this suite exists to cover.
export async function openPrintedSheet (
  page: Page,
  fixture: string,
  options: { colorScheme?: 'light' | 'dark', params?: Record<string, string> } = {}
): Promise<void> {
  await page.emulateMedia({ media: 'print', colorScheme: options.colorScheme ?? 'light' })
  await page.goto(harnessUrl(fixture, options.params))
  // The document paginates in a useLayoutEffect after first paint; waiting for
  // a sheet means every assertion runs against the paginated render.
  await page.locator('.print-page').first().waitFor()
}
