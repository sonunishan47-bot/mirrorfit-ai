/** Text of a fetch target. Objects are never stringified as `[object Object]`. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Request body when it is already text. Binary bodies are ignored. */
export function bodyText(body: BodyInit | null | undefined): string {
  return typeof body === 'string' ? body : '';
}

export function headersText(headers: HeadersInit | undefined): string {
  if (!headers) return '';
  if (headers instanceof Headers) {
    return [...headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');
  }
  if (Array.isArray(headers)) {
    return headers.map(([key, value]) => `${key}: ${value}`).join('\n');
  }
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}
