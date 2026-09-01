import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from 'promptfoo';
import type { LanguageModel } from 'ai';
import { createCodeReviewAgent } from '../src/agent.ts';
import { formatReviewComment } from '../src/format-review-comment.ts';

export default class CodeReviewProvider implements ApiProvider {
  private readonly modelId: string;
  // Test-only bypass mirroring CreateCodeReviewAgentOptions.model — never set by
  // the real promptfoo config, only by evals/provider's own unit test.
  private readonly model: LanguageModel | undefined;

  constructor(options: ProviderOptions) {
    this.modelId = options.config?.modelId;
    this.model = options.config?.model;
  }

  id(): string {
    return `code-review:${this.modelId}`;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const vars = context?.vars ?? {};
    const result = await createCodeReviewAgent({ modelId: this.modelId, model: this.model }).review({
      prTitle: String(vars.prTitle ?? ''),
      prDescription: String(vars.prDescription ?? ''),
      diff: String(vars.diff ?? ''),
    });

    return {
      output: formatReviewComment(result),
      metadata: { recommendation: result.recommendation },
    };
  }
}
