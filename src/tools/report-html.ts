import { z } from 'zod';

/**
 * UTF-8 size of the report HTML object copied into projects/{id}/report/.
 * Stdio has no express body limit, so the tool schema rejects a larger
 * value before a request is built.
 */
export const MAX_REPORT_HTML_BYTES = 100_000;

function reportHtmlUtf8Bytes(value: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') {
      throw new Error('not serializable');
    }
    serialized = encoded;
  } catch {
    throw new Error('Report HTML must be JSON-serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

export function assertReportHtml<T>(value: T): T {
  const bytes = reportHtmlUtf8Bytes(value);
  if (bytes > MAX_REPORT_HTML_BYTES) {
    throw new Error(`Report HTML must be at most ${MAX_REPORT_HTML_BYTES} bytes.`);
  }
  return value;
}

function rejectOversizedReportHtml(value: unknown, ctx: z.RefinementCtx): void {
  try {
    assertReportHtml(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const reportHtmlSchema = z.record(z.unknown()).superRefine(rejectOversizedReportHtml);
