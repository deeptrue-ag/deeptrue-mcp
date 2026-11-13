import { z } from 'zod';

/**
 * UTF-8 size of accept_project product_slug copied into projects/{id}/accept/.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_ACCEPT_PRODUCT_SLUG_BYTES = 100_000;

function acceptProductSlugUtf8Bytes(productSlug: string): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(productSlug);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Accept product slug must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertAcceptProductSlug(productSlug: string): string {
  const bytes = acceptProductSlugUtf8Bytes(productSlug);
  if (bytes > MAX_ACCEPT_PRODUCT_SLUG_BYTES) {
    throw new Error(`Accept product slug must be at most ${MAX_ACCEPT_PRODUCT_SLUG_BYTES} bytes.`);
  }
  return productSlug;
}

function rejectOversizedAcceptProductSlug(productSlug: string, ctx: z.RefinementCtx): void {
  try {
    assertAcceptProductSlug(productSlug);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const acceptProductSlugSchema = z.string().superRefine(rejectOversizedAcceptProductSlug);
