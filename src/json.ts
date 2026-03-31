/**
 * The single JSON helper used by every layer. Both the HTTP client and the UPS
 * adapter previously carried their own private copy of this function.
 */

/** Upper bound on how much of a non-JSON body we keep for error diagnostics. */
export const ERROR_BODY_SNIPPET_LIMIT = 2000;

/** Parses JSON, returning `undefined` instead of throwing on malformed input. */
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort diagnostic payload for a response body: structured JSON when the
 * body parses, otherwise a bounded prefix of the raw text.
 */
export function bodyForDiagnostics(
  text: string,
  limit: number = ERROR_BODY_SNIPPET_LIMIT,
): unknown {
  return safeJsonParse(text) ?? text.slice(0, limit);
}
