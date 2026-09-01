import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewComment } from '../src/format-review-comment.ts';
import type { CodeReviewResult } from '../src/schemas/review.ts';

function criterion(score: number, reasoning: string) {
  return { score, reasoning };
}

const SAMPLE_REVIEW: CodeReviewResult = {
  implementationCorrectness: criterion(9, 'Handles the happy path and the empty-input edge case.'),
  idiomaticity: criterion(8, 'Matches surrounding code style.'),
  complexity: criterion(9, 'Small, focused change.'),
  testRiskCoverage: criterion(7, 'Covers the main path, missing one error case.'),
  documentation: criterion(8, 'Comment explains the non-obvious ordering.'),
  securityAndSafety: criterion(10, 'No new input handling introduced.'),
  summary: 'A small, well-tested change with clear intent.',
  recommendation: 'pass',
};

test('output starts with the ai-cr:review marker', () => {
  const comment = formatReviewComment(SAMPLE_REVIEW);
  assert.equal(comment.split('\n')[0], '<!-- ai-cr:review -->');
});

test('renders all six criteria with score and reasoning', () => {
  const comment = formatReviewComment(SAMPLE_REVIEW);
  assert.match(comment, /Implementation correctness \| 9\/10 \| Handles the happy path/);
  assert.match(comment, /Idiomaticity \| 8\/10 \| Matches surrounding code style\./);
  assert.match(comment, /Complexity \| 9\/10 \| Small, focused change\./);
  assert.match(comment, /Test \/ risk coverage \| 7\/10 \| Covers the main path/);
  assert.match(comment, /Documentation \| 8\/10 \| Comment explains the non-obvious ordering\./);
  assert.match(comment, /Security and safety \| 10\/10 \| No new input handling introduced\./);
});

test('renders the summary paragraph', () => {
  const comment = formatReviewComment(SAMPLE_REVIEW);
  assert.match(comment, /A small, well-tested change with clear intent\./);
});

test('renders a bold PASS verdict when recommendation is pass', () => {
  const comment = formatReviewComment(SAMPLE_REVIEW);
  assert.match(comment, /\*\*Verdict: PASS\*\*/);
});

test('renders a bold FAIL verdict when recommendation is fail', () => {
  const comment = formatReviewComment({ ...SAMPLE_REVIEW, recommendation: 'fail' });
  assert.match(comment, /\*\*Verdict: FAIL\*\*/);
});

test('escapes a pipe character in reasoning so it cannot split the table', () => {
  const comment = formatReviewComment({
    ...SAMPLE_REVIEW,
    complexity: criterion(6, 'Uses a | in a match expression, e.g. `a | b`.'),
  });
  assert.match(comment, /Uses a \\\| in a match expression/);
});

test('collapses an embedded newline in reasoning to a space', () => {
  const comment = formatReviewComment({
    ...SAMPLE_REVIEW,
    complexity: criterion(6, 'First line.\nSecond line.'),
  });
  assert.match(comment, /First line\. Second line\./);
});
