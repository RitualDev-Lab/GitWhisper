import type { ProviderLocation } from "./types.js";

/**
 * Classifies a provider base URL as 'local' (loopback) or 'remote'.
 * Local strictly includes loopback addresses:
 * - localhost
 * - 127.0.0.1 to 127.255.255.255
 * - ::1 and [::1]
 * - 0.0.0.0
 *
 * All other addresses (including LAN IPs like 192.168.x.x, 10.x.x.x, and public domains)
 * are classified as 'remote' to guarantee the privacy boundary.
 */
export function classifyProviderLocation(baseUrl: string): ProviderLocation {
  if (!baseUrl || typeof baseUrl !== "string") {
    return "unknown";
  }

  try {
    // Handle URLs without protocol by prepending http://
    const normalizedUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
    const parsed = new URL(normalizedUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // 1. Localhost
    if (hostname === "localhost") {
      return "local";
    }

    // 2. IPv4 loopback (127.0.0.0/8) or 0.0.0.0
    if (hostname === "0.0.0.0" || /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/.test(hostname)) {
      return "local";
    }

    // 3. IPv6 loopback (::1 or 0:0:0:0:0:0:0:1)
    if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1" || hostname === "::ffff:127.0.0.1") {
      return "local";
    }

    // All others are considered remote
    return "remote";
  } catch {
    return "unknown";
  }
}
