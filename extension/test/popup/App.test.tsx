import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/popup/App.tsx'
import { installFakeBrowser, uninstallFakeBrowser, type FakeBrowser } from '../helpers/webext.ts'
import { createCollection } from '../helpers/translations.ts'

// jsdom has no speechSynthesis, so useSpeech settles to ready-with-no-voices
// (src/speech.ts:25-27, 35-38). Every language block therefore renders its
// "No <Language> voice is installed on this computer" line and every play
// button is disabled. That is unavoidable here and harmless — but it is why
// locators below are scoped by role rather than by loose text matching.

let fake: FakeBrowser

beforeEach(() => {
  fake = installFakeBrowser()
})

afterEach(() => {
  uninstallFakeBrowser()
})

describe('popup bootstrap', () => {
  it('shows the login view when the background reports no session', async () => {
    fake.handlers['auth-status'] = () => ({ authenticated: false })

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
  })

  it('loads collections and renders the picker when authenticated', async () => {
    const collection = createCollection({ name: 'Polish to English' })
    fake.handlers['auth-status'] = () => ({ authenticated: true })
    fake.handlers['list-collections'] = () => [collection]

    render(<App />)

    const select = await screen.findByRole('combobox')
    expect(select).toHaveValue(collection.id)
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  // The background script answers errors as { ok: false, error }, never as a
  // rejected sendMessage — the fake models that, and this is the case proving
  // the popup unwraps it rather than hanging on a pending promise.
  it('surfaces a background failure as an error, not a stuck loading state', async () => {
    fake.handlers['auth-status'] = () => {
      throw new Error('Your session expired — log in again.')
    }

    render(<App />)

    expect(await screen.findByText('Your session expired — log in again.')).toBeInTheDocument()
  })
})
