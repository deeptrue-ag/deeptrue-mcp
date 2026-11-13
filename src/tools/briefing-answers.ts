import { z } from 'zod';

/**
 * UTF-8 size of briefing answers. Stdio has no express body limit, so the
 * tool schema rejects a larger value before a request is built.
 */
export const MAX_BRIEFING_ANSWERS_BYTES = 100_000;

function briefingAnswersUtf8Bytes(answers: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(answers);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Briefing answers must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertBriefingAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const bytes = briefingAnswersUtf8Bytes(answers);
  if (bytes > MAX_BRIEFING_ANSWERS_BYTES) {
    throw new Error(`Briefing answers must be at most ${MAX_BRIEFING_ANSWERS_BYTES} bytes.`);
  }
  return answers;
}

export const briefingAnswersSchema = z.record(z.unknown()).superRefine((answers, ctx) => {
  try {
    assertBriefingAnswers(answers);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
