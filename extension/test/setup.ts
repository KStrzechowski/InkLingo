// The /vitest entry point both extends Vitest's expect with jest-dom's
// matchers (toBeInTheDocument, etc.) and pulls in their type augmentation.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// RTL only auto-registers this when the test globals are injected, and this
// project imports describe/it/expect explicitly instead — so without it,
// every rendered tree would stay mounted and leak into the next test.
afterEach(cleanup)
