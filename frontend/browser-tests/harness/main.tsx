// Entry point for print-harness.html.
//
// Mounts the production PrintDocument with fixture data — no auth gate, no
// network, no router. The point is that this renders the *same* component the
// real /collections/:id/print route renders, so a print regression shows up
// here; a hand-copied markup would drift and prove nothing.
//
// index.css is imported first on purpose: it carries the global #root shell and
// the @media (prefers-color-scheme: dark) variable block that print.css exists
// to override. Without it the harness would test print.css against a blank
// page and the dark-theme assertions would be meaningless.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PrintDocument from '../../src/pages/PrintDocument'
import { fixtures } from './fixtures'
import '../../src/index.css'

const params = new URLSearchParams(window.location.search)
const requested = params.get('fixture') ?? 'five-languages'

const collection = fixtures[requested]

const container = document.getElementById('root')

if (container === null) {
  throw new Error('harness: #root missing from print-harness.html')
}

if (collection === undefined) {
  // Fail loudly in the page rather than rendering an empty document that a
  // test would happily assert nothing against.
  container.textContent = `harness: unknown fixture "${requested}"`
} else {
  createRoot(container).render(
    <StrictMode>
      <PrintDocument collection={collection} />
    </StrictMode>
  )
}
