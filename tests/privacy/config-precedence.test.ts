import { enforceStrictPrivacyPolicy } from "@gitwhisper/config";
import { describe, expect, it } from "vitest";

describe("Phase 7 Strict Privacy Config Precedence", () => {
  it("prevents repository config from disabling scanSecrets when globally enabled", () => {
    const globalPrivacy = { scanSecrets: true };
    const repoPrivacy = { scanSecrets: false };

    const merged = enforceStrictPrivacyPolicy(globalPrivacy, repoPrivacy);
    expect(merged.scanSecrets).toBe(true);
  });

  it("prevents repository config from downgrading remote highConfidence action", () => {
    const globalPrivacy = {
      remote: {
        highConfidence: "block" as const,
        mediumConfidence: "redact" as const,
        lowConfidence: "warn" as const,
      },
    };
    const repoPrivacy = {
      // Trying to downgrade block -> redact
      remote: { highConfidence: "redact" as const },
    };

    const merged = enforceStrictPrivacyPolicy(globalPrivacy, repoPrivacy);
    expect(merged.remote?.highConfidence).toBe("block");
  });

  it("allows repository config to upgrade protection (e.g. redact -> block)", () => {
    const globalPrivacy = {
      remote: {
        highConfidence: "redact" as const,
        mediumConfidence: "redact" as const,
        lowConfidence: "warn" as const,
      },
    };
    const repoPrivacy = {
      // Upgrading redact -> block
      remote: { highConfidence: "block" as const },
    };

    const merged = enforceStrictPrivacyPolicy(globalPrivacy, repoPrivacy);
    expect(merged.remote?.highConfidence).toBe("block");
  });

  it("prevents repository config from enabling remote branch/repo transmission if globally disabled", () => {
    const globalPrivacy = {
      sendBranchName: false,
      sendRepositoryName: false,
    };
    const repoPrivacy = {
      sendBranchName: true,
      sendRepositoryName: true,
    };

    const merged = enforceStrictPrivacyPolicy(globalPrivacy, repoPrivacy);
    expect(merged.sendBranchName).toBe(false);
    expect(merged.sendRepositoryName).toBe(false);
  });
});
