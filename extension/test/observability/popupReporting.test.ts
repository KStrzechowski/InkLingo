import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportFromPopup } from '../../src/messages'
import { installFakeBrowser, uninstallFakeBrowser, type FakeBrowser } from '../helpers/webext'

// The popup cannot report directly: the buffer and host_permissions live in
// the background script, and Firefox destroys this document on focus loss. So
// popup-side failures travel as a message, and this is that contract.

let fake: FakeBrowser

beforeEach(() => {
  fake = installFakeBrowser()
})

afterEach(() => {
  uninstallFakeBrowser()
})

// reportFromPopup is fire-and-forget; give the floated promise a turn to land.
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }

describe('reportFromPopup', () => {
  it('sends the failure to the background script', async () => {
    reportFromPopup({ name: 'Error', message: 'popup blew up', routePath: 'popup:uncaught' })
    await settle()

    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]).toEqual({
      type: 'report-error',
      report: { name: 'Error', message: 'popup blew up', routePath: 'popup:uncaught' }
    })
  })

  it('never throws when the background is unreachable', async () => {
    // The condition being reported is often the same condition that breaks
    // reporting — a background script asleep, restarting, or mid-update. If
    // this threw, it would displace the error the user is already being shown.
    const api = globalThis as unknown as { browser: { runtime: { sendMessage: unknown } } }
    api.browser.runtime.sendMessage = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.')
    }

    expect(() => {
      reportFromPopup({ name: 'Error', message: 'popup blew up' })
    }).not.toThrow()
    await settle()
  })

  it('swallows the delivery failure rather than floating a rejection', async () => {
    const api = globalThis as unknown as { browser: { runtime: { sendMessage: unknown } } }
    const sendMessage = vi.fn(async () => { throw new Error('receiving end does not exist') })
    api.browser.runtime.sendMessage = sendMessage

    reportFromPopup({ name: 'Error', message: 'popup blew up' })
    await settle()

    // The catch is inside the floated async IIFE, so the rejection is handled
    // where it happens. Left unhandled it would surface as an
    // unhandledrejection — which the popup's own global handler would then try
    // to report, through the very channel that just failed.
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
