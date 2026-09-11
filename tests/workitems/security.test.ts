import {
  SecurityHostBindingError,
  SsrProtocolError,
  assertCredentialHostBinding,
  isHostTrusted,
  validateUrlProtocol,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 8 Security & Credential Host Binding (Release-Blocking)", () => {
  it("allows requests when destination host matches authorized host", () => {
    expect(() => {
      assertCredentialHostBinding(
        "https://jira.company.example/rest/api/2/issue/DEV-1",
        "jira.company.example",
      );
    }).not.toThrow();

    expect(() => {
      assertCredentialHostBinding(
        "https://api.github.com/repos/org/repo/issues/1",
        "api.github.com",
      );
    }).not.toThrow();
  });

  it("CRITICAL: blocks credential transmission when repo config directs tracker to attacker.example", () => {
    // Release-blocking test from Section 95:
    // Repository config points tracker to attacker.example while user token belongs to jira.company.example
    expect(() => {
      assertCredentialHostBinding(
        "https://attacker.example/rest/api/2/issue/DEV-1",
        "jira.company.example",
      );
    }).toThrow(SecurityHostBindingError);

    try {
      assertCredentialHostBinding("https://attacker.example/api", "jira.company.example");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(SecurityHostBindingError);
      expect((err as Error).message).toContain("attacker.example");
      expect((err as Error).message).toContain("jira.company.example");
    }
  });

  it("rejects non-HTTP/HTTPS protocols to prevent SSRF (file://, ftp://, gopher://)", () => {
    expect(() => validateUrlProtocol("file:///etc/passwd")).toThrow(SsrProtocolError);
    expect(() => validateUrlProtocol("ftp://internal.vault/secrets")).toThrow(SsrProtocolError);
    expect(() => validateUrlProtocol("gopher://local:70")).toThrow(SsrProtocolError);
    expect(() => validateUrlProtocol("https://api.github.com")).not.toThrow();
    expect(() => validateUrlProtocol("http://localhost:8080")).not.toThrow();
  });

  it("verifies trusted hosts and rejects arbitrary repository-controlled hosts without user approval", () => {
    expect(isHostTrusted("api.github.com")).toBe(true);
    expect(isHostTrusted("localhost")).toBe(true);
    expect(isHostTrusted("127.0.0.1")).toBe(true);

    expect(isHostTrusted("tracker.untrusted.example", [])).toBe(false);
    expect(isHostTrusted("tracker.internal.corp", ["tracker.internal.corp"])).toBe(true);
  });
});
