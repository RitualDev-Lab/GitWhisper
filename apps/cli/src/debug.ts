import { maskApiKey } from "@gitwhisper/config";

let debugMode = false;

export function setDebug(enabled: boolean): void {
  debugMode = enabled;
}

export function isDebug(): boolean {
  return debugMode;
}

function sanitizeValue(key: string, val: unknown): unknown {
  const lowerKey = key.toLowerCase();
  if (
    lowerKey.includes("key") ||
    lowerKey.includes("token") ||
    lowerKey.includes("auth") ||
    lowerKey.includes("secret") ||
    lowerKey.includes("password")
  ) {
    if (typeof val === "string") {
      return maskApiKey(val);
    }
    return "[REDACTED]";
  }

  if (lowerKey === "patch" || lowerKey === "diff") {
    if (typeof val === "string") {
      return `[Diff omitted: ${val.length} chars]`;
    }
  }

  if (val && typeof val === "object" && !Array.isArray(val)) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      clean[k] = sanitizeValue(k, v);
    }
    return clean;
  }

  return val;
}

export function logDebug(message: string, meta?: Record<string, unknown>): void {
  if (!debugMode) return;

  const timestamp = new Date().toISOString();
  let metaStr = "";
  if (meta) {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) {
      sanitized[k] = sanitizeValue(k, v);
    }
    metaStr = ` ${JSON.stringify(sanitized)}`;
  }

  process.stderr.write(`[DEBUG ${timestamp}] ${message}${metaStr}\n`);
}
