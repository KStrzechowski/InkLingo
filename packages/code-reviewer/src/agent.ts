import { ToolLoopAgent, tool, isStepCount, type LanguageModel } from 'ai';
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

export interface CreateCodeReviewAgentOptions {
  /** OpenRouter model id, e.g. "deepseek/deepseek-v4-flash". Ignored if `model` is set. */
  modelId?: string;
  /**
   * Inject a language model directly, bypassing OpenRouter entirely.
   * Exists so tests can pass a mock model — never used at runtime.
   */
  model?: LanguageModel;
}

// Cheap-tier default on purpose — this is a demonstration agent, not a
// production reviewer, and OpenRouter bills per token regardless of result
// quality. Override via CreateCodeReviewAgentOptions.modelId or the
// OPENROUTER_MODEL env var.
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

export function createCodeReviewAgent(options: CreateCodeReviewAgentOptions = {}): CodeReviewAgent {
  const model =
    options.model ??
    createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY }).chat(
      options.modelId || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    );

  let capturedReview: CodeReviewResult | undefined;

  const agent = new ToolLoopAgent({
    model,
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
