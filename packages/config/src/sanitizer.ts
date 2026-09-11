/**
 * Masks an API key for safe debugging output and logging.
 * Full keys are never revealed in terminal logs or error telemetry.
 */
export function maskApiKey(key?: string | null): string {
  if (!key) return "<not-set>";
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return "********";
  }

  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}
