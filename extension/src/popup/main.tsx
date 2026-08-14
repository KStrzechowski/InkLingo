import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './popup.css'
import App from './App.tsx'
import { reportFromPopup } from '../messages.ts'

// The frontend has had these since the evidence layer shipped
// (frontend/src/main.tsx); the popup had nothing. A render crash here blanked
// the popup with no trace anywhere — and because Firefox destroys this
// document the moment it loses focus, even the console line died with it.
// Reports go through the background script, which outlives the popup.
function describe (reason: unknown): { name: string, message: string, stack?: string } {
  if (reason instanceof Error) {
    return { name: reason.name, message: reason.message, stack: reason.stack }
  }
  return { name: 'UnhandledRejection', message: String(reason) }
}

window.addEventListener('error', (event: ErrorEvent) => {
  const described = event.error instanceof Error
    ? describe(event.error)
    : { name: 'Error', message: event.message }
  reportFromPopup({ ...described, routePath: 'popup:uncaught' })
})

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  reportFromPopup({ ...describe(event.reason), routePath: 'popup:unhandledrejection' })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
