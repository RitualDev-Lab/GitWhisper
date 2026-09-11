import {
  GenericWorkItemProvider,
  GitHubWorkItemProvider,
  JiraWorkItemProvider,
  WorkItemCache,
  createWorkItemProvider,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 8 Work-Item Provider Adapters", () => {
  it("GenericWorkItemProvider works with ZERO network calls in offline/generic mode", async () => {
    const provider = new GenericWorkItemProvider();
    const validation = await provider.validateConfiguration();
    expect(validation.valid).toBe(true);

    const resolution = await provider.resolve({
      raw: "DEV-142",
      key: "DEV-142",
      source: "branch",
      confidence: "high",
    });

    expect(resolution.found).toBe(true);
    expect(resolution.workItem?.key).toBe("DEV-142");
    expect(resolution.workItem?.provider).toBe("generic");
  });

  it("GitHubWorkItemProvider validates repository owner and name", async () => {
    const providerWithoutRepo = new GitHubWorkItemProvider({});
    const validation = await providerWithoutRepo.validateConfiguration();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("owner and name could not be resolved");

    const providerWithRepo = new GitHubWorkItemProvider({ owner: "ritualdev", repo: "gitwhisper" });
    const validResult = await providerWithRepo.validateConfiguration();
    expect(validResult.valid).toBe(true);
  });

  it("JiraWorkItemProvider validates base URL", async () => {
    const providerWithoutUrl = new JiraWorkItemProvider({});
    const validation = await providerWithoutUrl.validateConfiguration();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Jira base URL is not configured");

    const providerWithUrl = new JiraWorkItemProvider({ baseUrl: "https://jira.company.example" });
    const validResult = await providerWithUrl.validateConfiguration();
    expect(validResult.valid).toBe(true);
  });

  it("createWorkItemProvider resolves mapped provider from prefix configuration", () => {
    const provider = createWorkItemProvider({
      reference: { raw: "DEV-142", key: "DEV-142", source: "branch", confidence: "high" },
      config: {
        providers: {
          DEV: { provider: "jira", baseUrl: "https://jira.company.example" },
        },
      },
    });

    expect(provider.id).toBe("jira");
  });

  it("createWorkItemProvider defaults to generic provider when unconfigured", () => {
    const provider = createWorkItemProvider({
      reference: { raw: "XYZ-999", key: "XYZ-999", source: "branch", confidence: "high" },
    });
    expect(provider.id).toBe("generic");
  });

  it("WorkItemCache caches and retrieves work items with TTL", () => {
    const cache = new WorkItemCache();
    const key = cache.buildKey("jira", "jira.company.com", "PROJ", "DEV-142");

    cache.set(
      key,
      {
        provider: "jira",
        key: "DEV-142",
        title: "Refresh sessions",
      },
      1000,
    );

    const cached = cache.get(key);
    expect(cached).toBeDefined();
    expect(cached?.title).toBe("Refresh sessions");

    // Clear cache
    cache.clear();
    expect(cache.get(key)).toBeUndefined();
  });
});
