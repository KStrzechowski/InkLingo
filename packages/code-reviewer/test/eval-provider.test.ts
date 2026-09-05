import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import CodeReviewProvider from '../evals/provider.ts';
import type { CodeReviewResult } from '../src/schemas/review.ts';

const NO_USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

const SAMPLE_REVIEW: CodeReviewResult = {
  implementationCorrectness: { score: 3, reasoning: 'Missing dependency in useEffect.' },
  idiomaticity: { score: 8, reasoning: 'Matches surrounding code style.' },
  complexity: { score: 9, reasoning: 'Small, focused change.' },
  testRiskCoverage: { score: 4, reasoning: 'No tests added for the migration.' },
  documentation: { score: 8, reasoning: 'No new documentation needed.' },
  securityAndSafety: { score: 10, reasoning: 'No new input handling introduced.' },
  summary: 'The migration drops defaultProps and calls ReactDOM.render, which no longer exists in React 19.',
  recommendation: 'fail',
};

function modelReturning(review: CodeReviewResult): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'recordReview',
          input: JSON.stringify(review),
        },
      ],
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: NO_USAGE,
      warnings: [],
    }),
  });
}

const SAMPLE_VARS = { prTitle: 'Migrate to hooks', prDescription: '', diff: 'diff --git a/x b/x' };

test('callApi() reads config.modelId and threads it into the review, returning formatted output plus recommendation metadata', async () => {
  const model = modelReturning(SAMPLE_REVIEW);
  const provider = new CodeReviewProvider({ config: { modelId: 'z-ai/glm-5.1', model } });

  const response = await provider.callApi('ignored prompt', { vars: SAMPLE_VARS } as never);

  assert.equal(provider.id(), 'code-review:z-ai/glm-5.1');
  assert.match(response.output as string, /^<!-- ai-cr:review -->/);
  assert.match(response.output as string, /\*\*Verdict: FAIL\*\*/);
  assert.equal(response.metadata?.recommendation, 'fail');
});

test('callApi() propagates a rejection from the agent instead of swallowing it', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: "I don't see any issues." }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: NO_USAGE,
      warnings: [],
    }),
  });

  const provider = new CodeReviewProvider({ config: { modelId: 'z-ai/glm-5.1', model } });

  await assert.rejects(
    () => provider.callApi('ignored prompt', { vars: SAMPLE_VARS } as never),
    /finished without calling recordReview/,
  );
});
