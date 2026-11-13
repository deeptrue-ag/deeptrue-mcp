import { z } from 'zod';

/**
 * UTF-8 size of a value copied into a project create or update body.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_PROJECT_BODY_BYTES = 100_000;

function projectBodyUtf8Bytes(value: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Project body must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertProjectBody<T>(value: T): T {
  const bytes = projectBodyUtf8Bytes(value);
  if (bytes > MAX_PROJECT_BODY_BYTES) {
    throw new Error(`Project body must be at most ${MAX_PROJECT_BODY_BYTES} bytes.`);
  }
  return value;
}

function rejectOversizedProjectBody(value: unknown, ctx: z.RefinementCtx): void {
  try {
    assertProjectBody(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const projectBodyStringSchema = z.string().superRefine(rejectOversizedProjectBody);

export const projectBodyObjectSchema = z.record(z.unknown()).superRefine(rejectOversizedProjectBody);
