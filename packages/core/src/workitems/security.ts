export class SecurityHostBindingError extends Error {
  constructor(targetHost: string, allowedHost: string) {
    super(
      `Security Violation: Refusing to send credentials configured for host "${allowedHost}" to unauthorized destination "${targetHost}".`,
    );
    this.name = "SecurityHostBindingError";
  }
}

export class SsrProtocolError extends Error {
  constructor(protocol: string) {
    super(
      `Security Violation: Protocol "${protocol}" is not allowed. Only HTTP and HTTPS are permitted.`,
    );
    this.name = "SsrProtocolError";
  }
}

/**
 * Normalizes a host string by lowercasing and stripping port if default.
 */
export function normalizeHost(hostOrUrl: string): string {
  try {
    if (hostOrUrl.includes("://")) {
      const u = new URL(hostOrUrl);
      return u.hostname.toLowerCase();
    }
    return hostOrUrl.split(":")[0].toLowerCase();
  } catch {
    return hostOrUrl.toLowerCase();
  }
}

/**
 * Release-blocking security invariant:
 * Asserts that the request target URL matches the configured/authorized host for the given credentials.
 */
export function assertCredentialHostBinding(targetUrl: string, allowedHost: string): void {
  const targetHost = normalizeHost(targetUrl);
  const normalizedAllowed = normalizeHost(allowedHost);

  if (targetHost !== normalizedAllowed) {
    throw new SecurityHostBindingError(targetHost, normalizedAllowed);
  }
}

/**
 * Validates that the URL scheme is safe (only http: or https:).
 */
export function validateUrlProtocol(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: "${urlStr}"`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrProtocolError(url.protocol);
  }

  return url;
}

/**
 * Checks whether a host is trusted for outbound network lookups.
 * Official default hosts (api.github.com, gitlab.com) or localhost are trusted.
 */
export function isHostTrusted(host: string, trustedHosts: string[] = []): boolean {
  const norm = normalizeHost(host);
  if (
    norm === "api.github.com" ||
    norm === "gitlab.com" ||
    norm === "localhost" ||
    norm === "127.0.0.1"
  ) {
    return true;
  }
  return trustedHosts.some((th) => normalizeHost(th) === norm);
}

export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  allowedHost?: string;
  hasCredentials?: boolean;
}

/**
 * Safe fetch wrapper with SSRF protocol validation and redirect credential stripping.
 */
export async function safeFetch(
  inputUrl: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  let currentUrl = validateUrlProtocol(inputUrl);
  const maxRedirects = options.maxRedirects ?? 5;
  let redirectsRemaining = maxRedirects;

  // If credentials are present and allowedHost is configured, assert host binding
  if (options.hasCredentials && options.allowedHost) {
    assertCredentialHostBinding(currentUrl.toString(), options.allowedHost);
  }

  const headers = new Headers(options.headers || {});
  let hasAuth = headers.has("authorization") || headers.has("Authorization");

  while (true) {
    const fetchOptions: RequestInit = {
      ...options,
      headers,
      redirect: "manual", // Handle redirects deliberately
    };

    const response = await fetch(currentUrl.toString(), fetchOptions);

    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      if (redirectsRemaining <= 0) {
        throw new Error(`Too many redirects (exceeded ${maxRedirects})`);
      }
      redirectsRemaining--;

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      const nextUrl = new URL(location, currentUrl);
      validateUrlProtocol(nextUrl.toString());

      // If redirecting to a different origin/domain, strip Authorization header!
      if (nextUrl.origin !== currentUrl.origin && hasAuth) {
        headers.delete("authorization");
        headers.delete("Authorization");
        hasAuth = false;
      }

      currentUrl = nextUrl;
      continue;
    }

    return response;
  }
}
