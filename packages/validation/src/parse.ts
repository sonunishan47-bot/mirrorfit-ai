import type { z } from 'zod';

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

/**
 * Flattens Zod issues into a client-safe shape.
 *
 * Deliberately carries only the field path and the rule that failed. Zod's raw
 * issues can embed the received value, and echoing that back into an API
 * response is how submitted secrets end up in logs and error toasts.
 */
export function toFieldIssues(error: z.ZodError): readonly FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export function parseOrIssues<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): ParseResult<z.infer<TSchema>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, issues: toFieldIssues(result.error) };
}

/**
 * Parses a request body that may not be valid JSON at all.
 *
 * Returns the same issue shape as `parseOrIssues` so an API route has exactly
 * one error path to handle.
 */
export async function parseJsonBody<TSchema extends z.ZodType>(
  schema: TSchema,
  request: { json: () => Promise<unknown> },
): Promise<ParseResult<z.infer<TSchema>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, issues: [{ path: '', message: 'Request body must be valid JSON' }] };
  }
  return parseOrIssues(schema, raw);
}
