import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeReviewResultSchema } from '../src/schemas/review.ts';

function criterion(score = 8) {
  return { score, reasoning: 'Because the diff handles this well.' };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    implementationCorrectness: criterion(),
    idiomaticity: criterion(),
    complexity: criterion(),
    testRiskCoverage: criterion(),
    documentation: criterion(),
    securityAndSafety: criterion(),
    summary: 'A solid, well-tested change.',
    recommendation: 'pass',
    ...overrides,
  };
}

test('accepts a well-formed review', () => {
  const result = codeReviewResultSchema.safeParse(review());
  assert.equal(result.success, true);
});

test('rejects a score above 10', () => {
  const result = codeReviewResultSchema.safeParse(
    review({ implementationCorrectness: criterion(11) }),
  );
  assert.equal(result.success, false);
});

test('rejects a score below 1', () => {
  const result = codeReviewResultSchema.safeParse(review({ complexity: criterion(0) }));
  assert.equal(result.success, false);
});

test('rejects a missing criterion', () => {
  const { documentation, ...withoutDocumentation } = review();
  const result = codeReviewResultSchema.safeParse(withoutDocumentation);
  assert.equal(result.success, false);
});

test('rejects an invalid recommendation value', () => {
  const result = codeReviewResultSchema.safeParse(review({ recommendation: 'maybe' }));
  assert.equal(result.success, false);
});
