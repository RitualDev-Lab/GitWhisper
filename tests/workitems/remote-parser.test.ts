import { findPrimaryRemote, parseRemoteDetails, sanitizeRemoteUrl } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 8 Git Remote Parsing & Credential Scrubbing", () => {
  it("parses standard HTTPS GitHub remotes", () => {
    const remote = parseRemoteDetails("origin", "https://github.com/ritualdev/gitwhisper.git");
    expect(remote.host).toBe("github.com");
    expect(remote.owner).toBe("ritualdev");
    expect(remote.repository).toBe("gitwhisper");
    expect(remote.provider).toBe("github");
  });

  it("parses SSH git@ remotes accurately", () => {
    const remote = parseRemoteDetails("origin", "git@github.com:myorg/myrepo.git");
    expect(remote.host).toBe("github.com");
    expect(remote.owner).toBe("myorg");
    expect(remote.repository).toBe("myrepo");
    expect(remote.provider).toBe("github");
  });

  it("scrubs embedded user credentials from remote URLs", () => {
    const rawToken = ["ghp", "secretToken12345"].join("_");
    const sanitized = sanitizeRemoteUrl(`https://user:${rawToken}@github.com/org/repo.git`);
    expect(sanitized).not.toContain(rawToken);
    expect(sanitized).not.toContain("user:");
    expect(sanitized).toBe("https://github.com/org/repo.git");

    const remote = parseRemoteDetails(
      "origin",
      "https://oauth2:token999@gitlab.com/group/project.git",
    );
    expect(remote.url).not.toContain("token999");
    expect(remote.host).toBe("gitlab.com");
    expect(remote.provider).toBe("gitlab");
  });

  it("finds primary remote defaulting to origin", () => {
    const remotes = [
      { name: "upstream", url: "https://github.com/upstream/repo.git" },
      { name: "origin", url: "https://github.com/fork/repo.git" },
    ];
    const primary = findPrimaryRemote(remotes);
    expect(primary?.name).toBe("origin");
  });
});
