import {
  assertOrganizationLength,
  resolveSession,
  type AuthMaterial,
  type McpSession,
} from '../auth.js';
import type { McpConfig } from '../config.js';

export type ApiCallOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  params?: Record<string, unknown>;
  body?: unknown;
  org?: string;
};

function appendParams(url: URL, params?: Record<string, unknown>): void {
  if (!params) return;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }
    url.searchParams.append(key, String(value));
  }
}

function joinUrl(base: string, path: string, params?: Record<string, unknown>): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase);
  appendParams(url, params);
  return url.toString();
}

/** Project, survey, report, and audience ids placed in an API path. */
export const MAX_PATH_SEGMENT_LENGTH = 128;

/**
 * One path segment, at most 128 characters. `encodeURIComponent` keeps `/`, `?`,
 * `@`, and `://` inside the segment. `.` and `..` are not encoded, and the URL
 * parser also rewrites `%2E` / `%2E%2E`, so those values are rejected before a
 * request is built.
 */
export function encodePathSegment(value: string | number, label = 'Value'): string {
  const raw = String(value);
  if (raw.length > MAX_PATH_SEGMENT_LENGTH) {
    throw new Error(`${label} must be at most ${MAX_PATH_SEGMENT_LENGTH} characters.`);
  }
  const encoded = encodeURIComponent(raw);
  const probe = new URL(`http://org-segment.invalid/v1/org/${encoded}/projects/`);
  if (
    probe.username !== '' ||
    probe.password !== '' ||
    probe.hostname !== 'org-segment.invalid' ||
    probe.search !== '' ||
    probe.hash !== '' ||
    probe.pathname !== `/v1/org/${encoded}/projects/`
  ) {
    throw new Error(`${label} must be a single path segment.`);
  }
  return encoded;
}

function encodeOrganizationSegment(org: string): string {
  assertOrganizationLength(org);
  return encodePathSegment(org, 'Organization');
}

/** Statuses Node's fetch would follow, including across hosts. */
const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 307, 308]);
/** Same-origin hops followed for one call. A longer chain or a loop stops with an error. */
const MAX_REDIRECTS = 5;
/** Deadline for the initial request and for each same-host redirect hop. */
const ATTEMPT_TIMEOUT_MS = 60_000;

function beginAttemptTimeout(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

type HttpMethod = NonNullable<ApiCallOptions['method']>;

/**
 * Leading and trailing C0 controls and spaces, then ASCII tab and newline,
 * match the URL parser's preprocessing. Host characters are left as written.
 */
function trimLikeUrlParser(value: string): string {
  return value.replace(/^[\u0000-\u001F ]+|[\u0000-\u001F ]+$/g, '').replace(/[\t\n\r]/g, '');
}

function opensAuthority(value: string): boolean {
  let slashes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '/' && ch !== '\\') break;
    slashes += 1;
  }
  return slashes >= 2;
}

/** Authority text with `/`, `\`, `?`, and `#` as the end. No percent-decoding. */
function takeAuthority(value: string): string {
  let i = 0;
  while (i < value.length && (value[i] === '/' || value[i] === '\\')) i += 1;
  const start = i;
  while (
    i < value.length &&
    value[i] !== '/' &&
    value[i] !== '\\' &&
    value[i] !== '?' &&
    value[i] !== '#'
  ) {
    i += 1;
  }
  return value.slice(start, i);
}

/**
 * Origin spelled by an absolute or protocol-relative Location, or null when
 * the Location has no authority and inherits the current request. The scheme
 * and authority are not passed through the URL parser, so userinfo, `127.1`,
 * hex or decimal IPs, a trailing dot, percent-encoded dots, and an explicit
 * port stay different from the current origin.
 */
function rawLocationOrigin(location: string, currentOrigin: string): string | null {
  const input = trimLikeUrlParser(location);
  const currentScheme = currentOrigin.slice(0, currentOrigin.indexOf(':'));
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(input);
  if (schemeMatch) {
    const scheme = schemeMatch[1];
    const rest = schemeMatch[2];
    if (opensAuthority(rest)) return `${scheme}://${takeAuthority(rest)}`;
    if (scheme.toLowerCase() === currentScheme) return null;
    return `${scheme}://${takeAuthority(rest)}`;
  }
  if (opensAuthority(input)) return `${currentScheme}://${takeAuthority(input)}`;
  return null;
}

/**
 * Backslash, CR, LF, and tab are deleted or rewritten anywhere by the URL
 * parser. A leading or trailing vertical tab, form feed, or space is deleted.
 * U+0085, U+2028, and U+2029 are refused anywhere. Vertical tab and form feed
 * are refused anywhere too, including where the parser would only
 * percent-encode them. Leading and trailing C0 controls are deleted, so NUL
 * and the other C0 controls (U+0001-U+0008, U+000E, U+000F, U+0010-U+001F)
 * are refused anywhere, including where the parser would only percent-encode
 * them. DEL (U+007F) is percent-encoded rather than stripped and can still
 * leave a same-origin URL, so it is refused anywhere too. A space inside the
 * path or query is percent-encoded and is still followed. A space inside the
 * authority is not deleted; parsing it fails later. `%5C` and `%5c` are a
 * backslash after one percent-decode. The URL parser treats that `\` as `/`
 * and can fetch the rewritten URL, so they are refused before parsing.
 * `%09`, `%0A`, `%0D`, `%0a`, `%0d`, `%00`, `%1F`, `%7F`, and the other C0
 * encodings are a tab, CR, LF, VT, FF, other C0 control, or DEL after that
 * same single decode. The URL parser strips some of those and can fetch the
 * remainder, so they are refused before parsing. `%C2%85`, `%E2%80%A8`, and
 * `%E2%80%A9` are U+0085, U+2028, and U+2029 after one UTF-8 percent-decode.
 * That decode reads the bytes as UTF-8. It does not turn each `%XX` into its
 * own character, so `%E2%80%A8` is U+2028 and a lone `%85` is not U+0085.
 * `%255c`, `%250a`, and `%25E2%2580%25A8` decode to the characters `%5c`,
 * `%0a`, and `%E2%80%A8` and are not decoded again. `%20` in the path or
 * query is a space and is still followed.
 */
function percentDecodeOnce(value: string): string {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function isHexDigit(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

function appendUtf8CodePoint(bytes: number[], code: number): void {
  if (code < 0x80) {
    bytes.push(code);
    return;
  }
  if (code < 0x800) {
    bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    return;
  }
  if (code < 0x10000) {
    bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    return;
  }
  bytes.push(
    0xf0 | (code >> 18),
    0x80 | ((code >> 12) & 0x3f),
    0x80 | ((code >> 6) & 0x3f),
    0x80 | (code & 0x3f),
  );
}

/**
 * True when one UTF-8 percent-decode contains U+0085, U+2028, or U+2029.
 * `%XX` becomes that byte, literals stay in the same byte string, and the
 * bytes are read as UTF-8 once. `%C2%85` is U+0085. `%E2%80%A8` and
 * `%E2%80%A9` are U+2028 and U+2029. `%25E2%2580%25A8` is the characters
 * `%E2%80%A8`. A lone `%85` is not U+0085.
 */
function percentDecodeUtf8OnceHasUnicodeLineBreak(value: string): boolean {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; ) {
    if (
      value.charCodeAt(i) === 0x25 &&
      i + 2 < value.length &&
      isHexDigit(value.charCodeAt(i + 1)) &&
      isHexDigit(value.charCodeAt(i + 2))
    ) {
      bytes.push(Number.parseInt(value.slice(i + 1, i + 3), 16));
      i += 3;
      continue;
    }
    const code = value.codePointAt(i) ?? 0;
    if (code === 0x85 || code === 0x2028 || code === 0x2029) return true;
    appendUtf8CodePoint(bytes, code);
    i += code > 0xffff ? 2 : 1;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0xc2 && bytes[i + 1] === 0x85) return true;
    if (bytes[i] === 0xe2 && bytes[i + 1] === 0x80 && (bytes[i + 2] === 0xa8 || bytes[i + 2] === 0xa9)) {
      return true;
    }
  }
  return false;
}

/** Backslash, tab, CR, LF, VT, FF, the other C0 controls, and DEL. Not space. */
function containsRewrittenControl(value: string): boolean {
  if (
    value.includes('\\') ||
    value.includes('\r') ||
    value.includes('\n') ||
    value.includes('\t') ||
    value.includes('\v') ||
    value.includes('\f')
  ) {
    return true;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // U+0000-U+0008, U+000E-U+001F, and DEL. Tab, LF, VT, FF, and CR are above.
    if (code <= 0x08 || (code >= 0x0e && code <= 0x1f) || code === 0x7f) return true;
  }
  return false;
}

function redirectLocationRewrittenBeforeFetch(location: string): boolean {
  if (
    containsRewrittenControl(location) ||
    location.includes('\u0085') ||
    location.includes('\u2028') ||
    location.includes('\u2029') ||
    location.startsWith(' ') ||
    location.endsWith(' ')
  ) {
    return true;
  }
  // One pass. `%0a` becomes LF and `%5C` becomes `\`. `%250a` becomes `%0a`.
  // The byte-wise decode does not see `%E2%80%A8` as U+2028, so the UTF-8 pass
  // is separate and is not a second decode of the same bytes.
  if (containsRewrittenControl(percentDecodeOnce(location))) return true;
  return percentDecodeUtf8OnceHasUnicodeLineBreak(location);
}

/**
 * Next URL on this request's origin, or null when it must not be fetched.
 * A backslash, including one that appears only after a single percent-decode
 * (`%5C` or `%5c`), a raw CR/LF, tab, vertical tab, form feed, a leading or
 * trailing space, U+0085 / U+2028 / U+2029, NUL, any other C0 control, or DEL
 * is refused before parsing. A tab, CR, LF, VT, FF, other C0 control, or DEL
 * that appears only after that same single decode (`%09`, `%0A`, `%0D`,
 * `%0a`, `%0d`, `%00`, `%1F`, `%7F`, and the other C0 encodings) is refused
 * too. `%C2%85`, `%E2%80%A8`, and `%E2%80%A9` are U+0085, U+2028, and U+2029
 * after one UTF-8 percent-decode and are refused before parsing. The URL
 * parser treats `\` as `/` and deletes CR, LF, and tab anywhere, and it
 * deletes a leading or trailing C0 control, vertical tab, form feed, or
 * space, which lets a rewritten URL pass the raw-origin check and be
 * fetched. An interior C0 control or DEL is percent-encoded and can stay on
 * this origin. A space inside the path or query, including `%20`, may still
 * be followed. `%250a` is the characters `%0a` after one decode and is not
 * treated as a newline. `%25E2%2580%25A8` is the characters `%E2%80%A8` and
 * is not treated as U+2028.
 * `new URL().origin` and `.host` also rewrite aliases into the current
 * origin, so the Location's raw origin has to equal that origin exactly,
 * and the URL that would be fetched next has to have that same origin. A
 * path-only Location inherits it. Userinfo is removed so the bearer stays
 * the Authorization.
 */
function sameHostRedirect(currentUrl: string, location: string, allowedHost: string): URL | null {
  if (redirectLocationRewrittenBeforeFetch(location)) {
    return null;
  }
  let next: URL;
  try {
    next = new URL(location, currentUrl);
  } catch {
    return null;
  }
  const currentOrigin = new URL(currentUrl).origin;
  if (
    (next.protocol !== 'http:' && next.protocol !== 'https:') ||
    next.host !== allowedHost ||
    next.origin !== currentOrigin
  ) {
    return null;
  }
  const rawOrigin = rawLocationOrigin(location, currentOrigin);
  if (rawOrigin !== null && rawOrigin !== currentOrigin) return null;
  next.username = '';
  next.password = '';
  next.hash = '';
  // The next fetch uses this serialization. Refuse it when that URL's origin
  // is no longer the current request origin.
  if (new URL(next.toString()).origin !== currentOrigin) return null;
  return next;
}

function methodAndBodyAfterRedirect(
  status: number,
  method: HttpMethod,
  body: string | undefined,
): { method: HttpMethod; body: string | undefined } {
  const switchToGet =
    (status === 303 && method !== 'GET') || ((status === 301 || status === 302) && method === 'POST');
  if (switchToGet) return { method: 'GET', body: undefined };
  return { method, body };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The redirect decision does not depend on the unread body.
  }
}

/**
 * Node's fetch puts an invalid header value in the TypeError message.
 * That value is the session JWT, so it must not be returned to the caller.
 * Timeout and other errors that do not contain it are left unchanged.
 */
function errorWithoutAuthorization(error: unknown, authorization: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const token = authorization.startsWith('JWT ') ? authorization.slice(4) : '';
  const secrets = [authorization, token].filter((value) => value.length >= 8);
  if (!secrets.some((value) => message.includes(value))) {
    return error;
  }
  let redacted = message;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join('[redacted]');
  }
  return new Error(redacted);
}

export type SessionCacheHooks = {
  /** Drop the factory entry that still holds the rejected JWT. */
  onUnauthorized?: () => void;
  /** Remember this client only after a session exchange succeeds. */
  onRefreshed?: (client: DeepTrueApiClient) => void;
};

export class DeepTrueApiClient {
  constructor(
    private readonly config: McpConfig,
    private session: McpSession,
    private readonly material: AuthMaterial,
    private readonly sessionCache?: SessionCacheHooks,
  ) {}

  get org(): string {
    return this.session.org;
  }

  get scopes(): string[] {
    return this.session.scopes;
  }

  /** False once a 401 has discarded the JWT and a replacement exchange has not succeeded. */
  get hasSessionToken(): boolean {
    return this.session.token.length > 0;
  }

  /** Exchange a session JWT for another organization. Does not mutate this client. */
  async withOrg(org: string): Promise<DeepTrueApiClient> {
    if (!org || org === this.session.org) {
      return this;
    }
    const session = await resolveSession(this.config, { ...this.material, org });
    return new DeepTrueApiClient(this.config, session, { ...this.material, org }, this.sessionCache);
  }

  orgPath(suffix: string, org = this.session.org): string {
    const clean = suffix.replace(/^\//, '');
    return `org/${encodeOrganizationSegment(org)}/${clean}`;
  }

  async request<T = unknown>(options: ApiCallOptions): Promise<T> {
    return this.requestOnce(options, false);
  }

  private sessionMaterial(): AuthMaterial {
    return {
      ...this.material,
      org: this.material.org || this.session.org,
    };
  }

  /** Mint a session JWT. The previous token is not kept when this throws. */
  private async exchangeSession(): Promise<void> {
    this.session = await resolveSession(this.config, this.sessionMaterial());
    this.sessionCache?.onRefreshed?.(this);
  }

  private discardSession(): void {
    this.sessionCache?.onUnauthorized?.();
    this.session = { ...this.session, token: '' };
  }

  /**
   * Follow a redirect only when its raw origin is exactly this request's origin
   * (the configured API origin). A Location with a
   * backslash (raw, or `%5C` / `%5c` after one percent-decode), a C0 control or
   * DEL (raw, or `%09` / `%0A` / `%0D` / `%00` / `%1F` / `%7F` and the other C0
   * encodings after one percent-decode), U+0085 / U+2028 / U+2029 (raw, or
   * `%C2%85` / `%E2%80%A8` / `%E2%80%A9` after one UTF-8 percent-decode), or
   * whitespace the URL parser deletes is not followed. `%20` in the path or
   * query, `%250a`, and `%25E2%2580%25A8` still are.
   * `redirect: 'manual'` stops Node from requesting any other origin itself. The
   * bearer is sent again on that same origin. Each attempt aborts if that hop
   * does not respond in time.
   */
  private async fetchOnConfiguredHost(baseUrl: string, options: ApiCallOptions): Promise<Response> {
    const allowedHost = new URL(baseUrl).host;
    let url = joinUrl(baseUrl, options.path, options.params);
    let method: HttpMethod = options.method ?? (options.body ? 'POST' : 'GET');
    let body = options.body !== undefined ? JSON.stringify(options.body) : undefined;

    for (let followed = 0; ; followed += 1) {
      const attempt = beginAttemptTimeout(ATTEMPT_TIMEOUT_MS);
      const authorization = `JWT ${this.session.token}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          redirect: 'manual',
          signal: attempt.signal,
          headers: {
            Accept: 'application/json',
            Authorization: authorization,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body,
        });
      } catch (error) {
        throw errorWithoutAuthorization(error, authorization);
      } finally {
        attempt.cancel();
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response;
      }

      const location = response.headers.get('location');
      const next = location ? sameHostRedirect(url, location, allowedHost) : null;
      if (!next) {
        await discardBody(response);
        throw new Error(
          `DeepTrue API ${response.status} ${method} ${options.path}: redirect location is a different host`,
        );
      }
      if (followed >= MAX_REDIRECTS) {
        await discardBody(response);
        throw new Error(
          `DeepTrue API ${response.status} ${method} ${options.path}: too many redirects on the configured host`,
        );
      }

      await discardBody(response);
      const rewritten = methodAndBodyAfterRedirect(response.status, method, body);
      method = rewritten.method;
      body = rewritten.body;
      url = next.toString();
    }
  }

  private async requestOnce<T>(options: ApiCallOptions, retried: boolean): Promise<T> {
    if (!this.session.token) {
      await this.exchangeSession();
    }

    const baseUrl = this.config.apiBase;
    const method = options.method ?? (options.body ? 'POST' : 'GET');
    const response = await this.fetchOnConfiguredHost(baseUrl, options);

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (response.status === 401 && !retried) {
      // Drop the rejected JWT before exchanging again. A revoked key fails here
      // and must not be sent on the next call.
      this.discardSession();
      await this.exchangeSession();
      return this.requestOnce(options, true);
    }

    if (response.status === 401) {
      this.discardSession();
    }

    if (!response.ok) {
      const detail =
        typeof data === 'object' && data && 'detail' in data
          ? String((data as { detail: unknown }).detail)
          : text || response.statusText;
      throw new Error(`DeepTrue API ${response.status} ${method} ${options.path}: ${detail}`);
    }

    return data as T;
  }
}

export function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  };
}
