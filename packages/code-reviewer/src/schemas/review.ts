import { z } from 'zod';

export const reviewCriterionSchema = z.object({
  score: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe('1 = worst outcome, 10 = best outcome'),
  reasoning: z
    .string()
    .describe('Why this score, citing specific lines or behaviors from the diff'),
});

export const codeReviewResultSchema = z.object({
  implementationCorrectness: reviewCriterionSchema,
  idiomaticity: reviewCriterionSchema,
  complexity: reviewCriterionSchema,
  testRiskCoverage: reviewCriterionSchema,
  documentation: reviewCriterionSchema,
  securityAndSafety: reviewCriterionSchema,
  summary: z.string().describe('One paragraph overview of the change and the review verdict'),
  recommendation: z
    .enum(['pass', 'fail'])
    .describe('fail if any criterion scores 4 or below'),
});

export type ReviewCriterion = z.infer<typeof reviewCriterionSchema>;
export type CodeReviewResult = z.infer<typeof codeReviewResultSchema>;
