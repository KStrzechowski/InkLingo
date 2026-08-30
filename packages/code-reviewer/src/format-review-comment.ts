import type { CodeReviewResult, ReviewCriterion } from './schemas/review.ts';

const CRITERIA: Array<{ key: keyof CodeReviewResult; label: string }> = [
  { key: 'implementationCorrectness', label: 'Implementation correctness' },
  { key: 'idiomaticity', label: 'Idiomaticity' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'testRiskCoverage', label: 'Test / risk coverage' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'securityAndSafety', label: 'Security and safety' },
];

export function formatReviewComment(result: CodeReviewResult): string {
  const rows = CRITERIA.map(({ key, label }) => {
    const criterion = result[key] as ReviewCriterion;
    return `| ${label} | ${criterion.score}/10 | ${criterion.reasoning} |`;
  }).join('\n');

  const verdict = result.recommendation === 'pass' ? 'PASS' : 'FAIL';

  return [
    '<!-- ai-cr:review -->',
    '## AI Code Review',
    '',
    '| Criterion | Score | Reasoning |',
    '| --- | --- | --- |',
    rows,
    '',
    '**Summary**',
    '',
    result.summary,
    '',
    `**Verdict: ${verdict}**`,
  ].join('\n');
}
