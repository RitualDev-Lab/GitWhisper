import { createDefaultDetectors } from "./detectors/index.js";
import type {
  PrivacyConfigOptions,
  PrivacyIgnoreRule,
  ScanResult,
  SecretDetector,
  SecretFinding,
  SensitiveScanInput,
} from "./types.js";

export class PrivacyScanError extends Error {
  public readonly isFailClosed: boolean;
  public readonly causeError?: unknown;

  constructor(message: string, options?: { failClosed?: boolean; cause?: unknown }) {
    super(message);
    this.name = "PrivacyScanError";
    this.isFailClosed = options?.failClosed ?? true;
    this.causeError = options?.cause;
  }
}

export interface ScanOptions {
  detectors?: SecretDetector[];
  config?: Partial<PrivacyConfigOptions>;
}

/**
 * Executes secret scanning across staged patches or text.
 * Implements strict FAIL-CLOSED guarantees:
 * If scanning encounters an exception or exceeds the size limit, it rejects
 * the scan rather than allowing uninspected data to flow to remote models.
 */
export async function scanSensitiveContent(
  input: SensitiveScanInput,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const config = options.config;
  const maxBytes = config?.maxScanSizeBytes ?? 10 * 1024 * 1024; // 10MB

  const patchBytes = input.patch ? Buffer.byteLength(input.patch, "utf8") : 0;
  const textBytes = input.text ? Buffer.byteLength(input.text, "utf8") : 0;
  const totalBytes = patchBytes + textBytes;

  if (totalBytes > maxBytes) {
    throw new PrivacyScanError(
      `Staged diff payload (${totalBytes} bytes) exceeds maximum scan limit (${maxBytes} bytes). Halting transmission to prevent un-scanned leaks.`,
      { failClosed: true },
    );
  }

  const detectors = options.detectors ?? createDefaultDetectors(config?.customPatterns ?? []);

  const rawFindings: SecretFinding[] = [];

  try {
    for (const detector of detectors) {
      const result = await detector.scan(input);
      rawFindings.push(...result);
    }
  } catch (err) {
    // FAIL CLOSED: Never fail open on scanner error
    throw new PrivacyScanError(
      `Privacy scanner encountered an unexpected error during execution: ${
        err instanceof Error ? err.message : String(err)
      }. Transmission blocked.`,
      { failClosed: true, cause: err },
    );
  }

  // Deduplicate and filter ignored findings
  const ignoreRules: PrivacyIgnoreRule[] = config?.ignore ?? [];
  const dedupedMap = new Map<string, SecretFinding>();

  for (const finding of rawFindings) {
    const isIgnored = ignoreRules.some((rule: PrivacyIgnoreRule) => {
      if (rule.path && !finding.filePath.includes(rule.path)) return false;
      if (rule.detector && finding.detector !== rule.detector) return false;
      if (rule.fingerprint && finding.fingerprint !== rule.fingerprint) return false;
      return true;
    });

    if (!isIgnored) {
      const key = `${finding.filePath}:${finding.lineNumber}:${finding.matchedText}:${finding.lineType}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, finding);
      }
    }
  }

  return {
    findings: Array.from(dedupedMap.values()),
    scannedBytes: totalBytes,
  };
}
