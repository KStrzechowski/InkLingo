import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { installGlobalErrorReporting } from './observability/globalHandlers.ts'
import { ErrorBoundary } from './observability/ErrorBoundary.tsx'

// Before render, so a failure during the first paint is captured too.
installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* Inside the router so the fallback could offer navigation, and outside
          <Routes> so it covers every route rather than one. */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
