import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCodeReviewAgent } from './agent.ts';

export { createCodeReviewAgent } from './agent.ts';
export type { CodeReviewAgent, CodeReviewInput } from './agent.ts';
export { codeReviewResultSchema, type CodeReviewResult } from './schemas/review.ts';

async function main(): Promise<void> {
  const [diffPath, title = 'Untitled PR', description = ''] = process.argv.slice(2);

  if (!diffPath) {
    console.error('Usage: tsx src/index.ts <diff-file> [pr-title] [pr-description]');
    process.exitCode = 1;
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      'OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your key (see https://openrouter.ai/keys).',
    );
    process.exitCode = 1;
    return;
  }

  const diff = await readFile(diffPath, 'utf-8');
  const agent = createCodeReviewAgent();
  const result = await agent.review({ prTitle: title, prDescription: description, diff });

  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
