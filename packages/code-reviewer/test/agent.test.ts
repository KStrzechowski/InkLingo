import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { createCodeReviewAgent } from '../src/agent.ts';
import type { CodeReviewResult } from '../src/schemas/review.ts';

const NO_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

const SAMPLE_REVIEW: CodeReviewResult = {
  implementationCorrectness: { score: 9, reasoning: 'Handles the happy path and the empty-input edge case.' },
  idiomaticity: { score: 8, reasoning: 'Matches surrounding code style.' },
  complexity: { score: 9, reasoning: 'Small, focused change.' },
  testRiskCoverage: { score: 7, reasoning: 'Covers the main path, missing one error case.' },
  documentation: { score: 8, reasoning: 'Comment explains the non-obvious ordering.' },
  securityAndSafety: { score: 10, reasoning: 'No new input handling introduced.' },
  summary: 'A small, well-tested change with clear intent.',
  recommendation: 'pass',
};

test('review() resolves with the recordReview tool input when the model calls it', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'recordReview',
          input: JSON.stringify(SAMPLE_REVIEW),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: NO_USAGE,
      warnings: [],
    }),
  });

  const agent = createCodeReviewAgent({ model });
  const result = await agent.review({ prTitle: 'Add feature', prDescription: '', diff: 'diff --git a/x b/x' });

  assert.deepEqual(result, SAMPLE_REVIEW);
});

test('review() throws when the model finishes without calling recordReview', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: "I don't see any issues." }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: NO_USAGE,
      warnings: [],
    }),
  });

  const agent = createCodeReviewAgent({ model });

  await assert.rejects(
    () => agent.review({ prTitle: 'Add feature', prDescription: '', diff: 'diff --git a/x b/x' }),
    /finished without calling recordReview/,
  );
});
