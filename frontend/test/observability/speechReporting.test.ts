import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { flush, resetForTests, type BufferedReport } from '../../src/observability/reporter'

// Speech failures are the third class the evidence layer could not see. They
// arrive as a *callback* on the utterance or as a rejected voice-list promise:
// no request, so the axios interceptor never sees them, and not a window
// event, so globalHandlers never sees them either.
const state = vi.hoisted(() => ({
  loadVoices: vi.fn(),
  cancel: vi.fn(),
  speak: vi.fn(),
  findVoice: vi.fn()
}))

vi.mock('../../src/speech', () => ({
  loadVoices: state.loadVoices,
  cancel: state.cancel,
  speak: state.speak,
  findVoice: state.findVoice
}))

const { useSpeech } = await import('../../src/useSpeech')

function collect () {
  const batches: BufferedReport[][] = []
  const send = async (reports: BufferedReport[]) => {
    batches.push(reports)
    return reports.map((entry) => entry.eventId)
  }
  return { send, batches }
}

beforeEach(() => {
  vi.resetAllMocks()
  resetForTests()
  // The real findVoice returns null when nothing matches; a bare vi.fn()
  // returns undefined, and hasVoice's `!== null` check would read that as a
  // match. Default it to the real "no match" value.
  state.findVoice.mockReturnValue(null)
})

describe('voice-list load failure', () => {
  it('reports the rejection the bare catch used to discard', async () => {
    state.loadVoices.mockRejectedValue(new Error('getVoices threw'))

    renderHook(() => useSpeech())
    await waitFor(() => expect(state.loadVoices).toHaveBeenCalled())

    const { send, batches } = collect()
    await waitFor(async () => {
      await flush(send)
      expect(batches[0]).toBeDefined()
    })

    expect(batches[0][0].message).toBe('getVoices threw')
    expect(batches[0][0].routePath).toBe('speech:loadVoices')
  })

  it('is distinguishable from "loaded, but no voice for this language"', async () => {
    state.loadVoices.mockRejectedValue(new Error('getVoices threw'))

    const { result } = renderHook(() => useSpeech())
    await waitFor(() => expect(result.current.ready).toBe(true))

    // The bug this closes: both cases collapsed into an empty voice list, so a
    // failed load rendered as "No voice is installed on this computer for X" —
    // a confident, specific, wrong diagnosis that sends the user off to install
    // a voice that would not have helped.
    expect(result.current.loadFailed).toBe(true)
    expect(result.current.hasVoice('en')).toBe(false)
  })

  it('leaves loadFailed false when the list simply has no match', async () => {
    state.loadVoices.mockResolvedValue([])
    state.findVoice.mockReturnValue(null)

    const { result } = renderHook(() => useSpeech())
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.loadFailed).toBe(false)
    expect(result.current.hasVoice('en')).toBe(false)
  })
})
