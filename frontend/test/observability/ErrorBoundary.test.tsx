import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../../src/observability/ErrorBoundary'
import { flush, resetForTests, type BufferedReport } from '../../src/observability/reporter'

function Boom (): never {
  throw new Error('render exploded')
}

function collect () {
  const batches: BufferedReport[][] = []
  const send = async (reports: BufferedReport[]) => {
    batches.push(reports)
    return reports.map((entry) => entry.eventId)
  }
  return { send, batches }
}

beforeEach(() => {
  resetForTests()
  // React logs caught render errors to console.error by design; silencing it
  // keeps the test output readable without hiding the assertion below.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary', () => {
  it('renders a recovery affordance instead of the blank page React leaves', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    // The gap this closes: React 19 already *reported* render crashes via the
    // window error event, but unmounted the root, so the user saw nothing at
    // all. Evidence without recovery.
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument()
  })

  it('reports the crash with its component stack', async () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    const { send, batches } = collect()
    await flush(send)

    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0].message).toBe('render exploded')
    // The component stack is what a plain stack trace does not give: which
    // tree crashed, not just which function threw.
    expect(batches[0][0].request?.bodyKeys?.length).toBeGreaterThan(0)
    expect(batches[0][0].request?.bodyKeys?.join(' ')).toContain('Boom')
  })

  it('leaves a healthy tree alone', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>
    )

    expect(screen.getByText('all fine')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
