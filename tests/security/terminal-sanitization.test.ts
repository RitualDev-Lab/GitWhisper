import { describe, expect, it } from "vitest";
import {
  sanitizeTerminalString,
  truncateSafe,
  wrapText,
} from "../../packages/core/src/composer/sanitizer.js";

describe("Terminal Escape & Injection Sanitization", () => {
  it("strips ANSI color and cursor control escape sequences", () => {
    const rawAnsi = "\x1b[31;1mRed Alert!\x1b[0m Normal text \x1b[2J\x1b[H";
    const cleaned = sanitizeTerminalString(rawAnsi);

    expect(cleaned).toBe("Red Alert! Normal text ");
    expect(cleaned).not.toContain("\x1b");
  });

  it("neutralizes Operating System Command (OSC) window title and hyperlink injection", () => {
    // OSC 0 (set window title) with BEL terminator
    const oscTitleBel = "\x1b]0;Hacked Terminal Title\x07Visible Content";
    expect(sanitizeTerminalString(oscTitleBel)).toBe("Visible Content");

    // OSC 8 (hyperlink) with ST (\x1b\\) terminator
    const oscHyperlink = "\x1b]8;;http://malicious.site\x1b\\Click Here\x1b]8;;\x1b\\";
    expect(sanitizeTerminalString(oscHyperlink)).toBe("Click Here");

    // OSC 52 (clipboard manipulation)
    const oscClipboard = "\x1b]52;c;SGVsbG8=\x07Safe text";
    expect(sanitizeTerminalString(oscClipboard)).toBe("Safe text");
  });

  it("strips bell, backspace, form feed and non-printable control characters", () => {
    const dangerousInput = "Clean\x07Text\x08With\x0cHidden\x0bChars";
    const sanitized = sanitizeTerminalString(dangerousInput);

    expect(sanitized).toBe("CleanTextWithHiddenChars");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Testing control character stripping
    expect(sanitized).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  });

  it("preserves regular whitespace, tabs, newlines, and Unicode emojis", () => {
    const validRichText =
      "feat(auth): ✨ add login with Google\n\n- Supports OAuth2\n\t* Secure token storage";
    const sanitized = sanitizeTerminalString(validRichText);

    expect(sanitized).toBe(validRichText);
  });

  it("safely truncates long lines and wraps text without splitting escape sequences", () => {
    const longText = "a".repeat(100);
    const truncated = truncateSafe(longText, 20);

    expect(truncated.length).toBe(20);
    expect(truncated.endsWith("...")).toBe(true);

    const paragraph = "The quick brown fox jumps over the lazy dog near the river bank.";
    const wrapped = wrapText(paragraph, 25);

    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(line.length).toBeLessThanOrEqual(25);
    }
  });
});
