import {
  containsReference,
  formatReferenceTrailer,
  insertReferenceIntoMessage,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 8 Reference Formatter & Policy Enforcement", () => {
  it("defaults to 'Refs <id>' and NEVER outputs 'Fixes' by default (Section 99)", () => {
    // Default reference mode
    const trailer = formatReferenceTrailer("#321");
    expect(trailer).toBe("Refs #321");
    expect(trailer).not.toContain("Fixes");
  });

  it("only produces 'Fixes' when mode is explicitly configured as 'close'", () => {
    const trailer = formatReferenceTrailer("#321", { mode: "close", closingKeyword: "Fixes" });
    expect(trailer).toBe("Fixes #321");
  });

  it("suppresses trailer when mode is 'none'", () => {
    const trailer = formatReferenceTrailer("DEV-142", { mode: "none" });
    expect(trailer).toBe("");
  });

  it("formats commit footer with a clean preceding blank line", () => {
    const message =
      "fix(auth): refresh sessions before expiry\n\nRefresh expiring authentication sessions.";
    const result = insertReferenceIntoMessage(message, "DEV-142", { mode: "reference" });

    expect(result).toBe(
      "fix(auth): refresh sessions before expiry\n\nRefresh expiring authentication sessions.\n\nRefs DEV-142",
    );
  });

  it("prevents duplicate references if reference is already present in message", () => {
    const existing = "fix(auth): DEV-142 refresh sessions\n\nRefresh sessions.";
    const result = insertReferenceIntoMessage(existing, "DEV-142", { mode: "reference" });
    expect(result).toBe(existing); // No duplicate trailer added
  });

  it("supports subject placement for ticket-prefix style repositories", () => {
    const message = "feat(auth): add session expiry handler";
    const result = insertReferenceIntoMessage(message, "DEV-142", { mode: "reference" }, "subject");
    expect(result).toBe("DEV-142 feat(auth): add session expiry handler");
  });

  it("accurately detects existing references using containsReference", () => {
    expect(containsReference("Refs #123", "#123")).toBe(true);
    expect(containsReference("feat(auth): DEV-142 session fix", "DEV-142")).toBe(true);
    expect(containsReference("fix: dev-1422 is different", "DEV-142")).toBe(false);
  });
});
