/**
 * Sanitizes arbitrary log strings, debug output, and HTTP headers to prevent
 * credentials and sensitive tokens from leaking to the console or logs.
 */
export function sanitizeLogString(raw: string, sensitiveValues: string[] = []): string {
  if (!raw || typeof raw !== "string") return raw;

  let sanitized = raw;

  // 1. Sanitize Authorization headers
  sanitized = sanitized.replace(
    /(?:Authorization|Proxy-Authorization)\s*:\s*(Bearer|Basic|Token)\s+[^\s\r\n]+/gi,
    "Authorization: $1 [REDACTED]",
  );

  // 2. Sanitize API Key headers
  sanitized = sanitized.replace(
    /(?:X-API-Key|api-key|x-token)\s*:\s*[^\s\r\n]+/gi,
    "X-API-Key: [REDACTED]",
  );

  // 3. Sanitize URL query parameters (api_key, key, secret, token, password)
  sanitized = sanitized.replace(
    /([?&](?:api[_-]?key|key|secret|token|password)=)[^&\s]+/gi,
    "$1[REDACTED]",
  );

  // 4. Sanitize JSON fields for secrets
  sanitized = sanitized.replace(
    /("(?:apiKey|api_key|token|password|secret|clientSecret)"\s*:\s*")[^"]+(")/gi,
    "$1[REDACTED]$2",
  );

  // 5. Sanitize explicitly provided sensitive values
  for (const secret of sensitiveValues) {
    if (secret && secret.length >= 4 && sanitized.includes(secret)) {
      sanitized = sanitized.replaceAll(secret, "[REDACTED]");
    }
  }

  return sanitized;
}
