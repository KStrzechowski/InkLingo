import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_REVIEW_SYSTEM_PROMPT } from '../src/prompts/code-review.ts';

const CRITERIA = [
  'implementation correctness',
  'idiomaticity',
  'complexity',
  'test / risk coverage',
  'documentation',
  'security and safety',
];

test('prompt mentions every graded criterion', () => {
  const lower = CODE_REVIEW_SYSTEM_PROMPT.toLowerCase();
  for (const criterionName of CRITERIA) {
    assert.ok(lower.includes(criterionName), `prompt is missing criterion: ${criterionName}`);
  }
});

test('prompt instructs the model to call recordReview exactly once', () => {
  assert.match(CODE_REVIEW_SYSTEM_PROMPT, /recordReview/);
  assert.match(CODE_REVIEW_SYSTEM_PROMPT.toLowerCase(), /exactly once/);
});
