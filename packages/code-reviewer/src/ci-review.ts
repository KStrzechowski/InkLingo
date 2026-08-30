import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createCodeReviewAgent } from './agent.ts';
import { formatReviewComment } from './format-review-comment.ts';

async function main(): Promise<void> {
  const prTitle = process.env.PR_TITLE ?? '';
  const prDescription = process.env.PR_DESCRIPTION ?? '';
  const diffFile = process.env.DIFF_FILE;

  if (!diffFile) {
    throw new Error('DIFF_FILE environment variable is required.');
  }

  const diff = await readFile(diffFile, 'utf-8');
  const agent = createCodeReviewAgent();
  const result = await agent.review({ prTitle, prDescription, diff });

  const outputDir = dirname(diffFile);
  await writeFile(join(outputDir, 'review-comment.md'), formatReviewComment(result), 'utf-8');
  await writeFile(join(outputDir, 'review-result.json'), JSON.stringify(result, null, 2), 'utf-8');

  console.log(result.recommendation);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
