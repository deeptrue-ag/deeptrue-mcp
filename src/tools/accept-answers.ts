import { z } from 'zod';

/**
 * UTF-8 size of accept_project answers copied into projects/{id}/accept/.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_ACCEPT_ANSWERS_BYTES = 100_000;

function acceptAnswersUtf8Bytes(answers: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(answers);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Accept answers must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertAcceptAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const bytes = acceptAnswersUtf8Bytes(answers);
  if (bytes > MAX_ACCEPT_ANSWERS_BYTES) {
    throw new Error(`Accept answers must be at most ${MAX_ACCEPT_ANSWERS_BYTES} bytes.`);
  }
  return answers;
}

function rejectOversizedAcceptAnswers(answers: Record<string, unknown>, ctx: z.RefinementCtx): void {
  try {
    assertAcceptAnswers(answers);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const acceptAnswersSchema = z.record(z.unknown()).superRefine(rejectOversizedAcceptAnswers);
