import { ToolLoopAgent, tool, isStepCount } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { codeReviewResultSchema, type CodeReviewResult } from './schemas/review.ts';
import { CODE_REVIEW_SYSTEM_PROMPT } from './prompts/code-review.ts';

export interface CodeReviewInput {
  prTitle: string;
  prDescription: string;
  diff: string;
}

export interface CodeReviewAgent {
  review(input: CodeReviewInput): Promise<CodeReviewResult>;
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

export function createCodeReviewAgent(modelId: string = DEFAULT_MODEL): CodeReviewAgent {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

  let capturedReview: CodeReviewResult | undefined;

  const agent = new ToolLoopAgent({
    model: openrouter.chat(modelId),
    instructions: CODE_REVIEW_SYSTEM_PROMPT,
    tools: {
      recordReview: tool({
        description: 'Submit the completed code review with a score for each criterion.',
        inputSchema: codeReviewResultSchema,
        execute: async (review: CodeReviewResult) => {
          capturedReview = review;
          return { received: true };
        },
      }),
    },
    stopWhen: isStepCount(4),
  });

  return {
    async review(input: CodeReviewInput): Promise<CodeReviewResult> {
      capturedReview = undefined;

      await agent.generate({
        prompt: [
          `Pull request title: ${input.prTitle}`,
          '',
          `Description:\n${input.prDescription || '(none provided)'}`,
          '',
          `Diff:\n${input.diff}`,
        ].join('\n'),
      });

      if (!capturedReview) {
        throw new Error('Code review agent finished without calling recordReview.');
      }

      return capturedReview;
    },
  };
}
