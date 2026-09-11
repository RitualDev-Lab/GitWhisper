import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidConfigError,
  loadConfig,
  resolveCommitPolicy,
  validateRepositoryConfig,
} from "@gitwhisper/config";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

describe("Team Configuration & Commit Policy Resolution", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-team-policy-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("validates repository configuration schema and detects invalid types", () => {
    const invalidConfig = {
      commit: {
        maxSubjectLength: "not-a-number",
        allowedTypes: "not-an-array",
      },
      hooks: {
        commitMsg: "invalid-mode",
      },
    };

    const validation = validateRepositoryConfig(invalidConfig);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("throws InvalidConfigError when loading malformed repo config", async () => {
    await repo.writeFile(
      ".gitwhisper.json",
      JSON.stringify({
        commit: {
          style: "unsupported-style",
        },
      }),
    );

    await expect(loadConfig({}, repo.dir)).rejects.toThrow(InvalidConfigError);
  });

  it("loads valid .gitwhisper.json and applies custom types and scopes", async () => {
    await repo.writeFile(
      ".gitwhisper.json",
      JSON.stringify({
        commit: {
          allowedTypes: ["feature", "bugfix", "hotfix"],
          scopes: ["auth", "payments", "billing"],
          strictScopes: true,
          requireWorkItem: true,
          maxSubjectLength: 60,
        },
        hooks: {
          commitMsg: "strict",
        },
      }),
    );

    const config = await loadConfig({}, repo.dir);
    expect(config.commit.allowedTypes).toEqual(["feature", "bugfix", "hotfix"]);
    expect(config.commit.scopes).toEqual(["auth", "payments", "billing"]);
    expect(config.commit.strictScopes).toBe(true);
    expect(config.commit.requireWorkItem).toBe(true);
    expect(config.commit.maxSubjectLength).toBe(60);
    expect(config.hooks.commitMsg).toBe("strict");

    const policy = resolveCommitPolicy(config);
    expect(policy.allowedTypes).toEqual(["feature", "bugfix", "hotfix"]);
    expect(policy.scopes).toEqual(["auth", "payments", "billing"]);
    expect(policy.requireWorkItem).toBe(true);
    expect(policy.strictScopes).toBe(true);
  });

  it("preserves Phase 7 privacy safeguards against weakening via repo config", async () => {
    await repo.writeFile(
      ".gitwhisper.json",
      JSON.stringify({
        privacy: {
          scanSecrets: false, // Attempt to disable secret scanning
          remote: {
            highConfidence: "ignore", // Attempt to ignore high confidence secrets
          },
        },
      }),
    );

    const config = await loadConfig({}, repo.dir);
    // Secret scanning must remain true
    expect(config.privacy.scanSecrets).toBe(true);
    // High confidence secrets must not be downgraded to ignore
    expect(config.privacy.remote.highConfidence).toBe("block");
  });

  it("gives CLI overrides higher precedence than repository config", async () => {
    await repo.writeFile(
      ".gitwhisper.json",
      JSON.stringify({
        commit: {
          style: "simple",
          maxSubjectLength: 50,
        },
      }),
    );

    const config = await loadConfig(
      {
        commit: {
          style: "conventional",
        },
      },
      repo.dir,
    );

    expect(config.commit.style).toBe("conventional");
  });
});
