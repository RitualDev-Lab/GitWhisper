import { cleanIssueText, sanitizeWorkItemForAI } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 8 Work-Item Privacy & Data Minimization", () => {
  it("redacts synthetic secret tokens embedded in issue descriptions before AI transmission (Section 102)", async () => {
    const rawSecret = "AKIAIOSFODNN7EXAMPLE";
    const workItem = {
      provider: "jira" as const,
      key: "DEV-142",
      title: "Fix authentication leak",
      description: `Customer reported that AWS credentials were leaked: aws_key=${rawSecret} in logs`,
    };

    const sanitized = await sanitizeWorkItemForAI(workItem);

    expect(sanitized.relevantSummary).toBeDefined();
    // Raw AWS secret MUST be redacted
    expect(sanitized.relevantSummary).not.toContain(rawSecret);
    expect(sanitized.relevantSummary).toContain("<GITWHISPER_REDACTED_AWS_KEY>");
  });

  it("enforces data minimization by bounding title and description lengths", async () => {
    const longTitle = "A".repeat(300);
    const longDesc = "B".repeat(1000);

    const workItem = {
      provider: "github" as const,
      key: "#99",
      title: longTitle,
      description: longDesc,
    };

    const sanitized = await sanitizeWorkItemForAI(workItem);

    expect(sanitized.title?.length).toBeLessThanOrEqual(200);
    expect(sanitized.relevantSummary?.length).toBeLessThanOrEqual(500);
  });

  it("strips HTML tags and markdown images from untrusted issue text", () => {
    const dirty =
      "<div>Fix issue</div> <p>See screenshot: ![diagram](https://cdn.example/image.png)</p>";
    const cleaned = cleanIssueText(dirty);
    expect(cleaned).not.toContain("<div>");
    expect(cleaned).not.toContain("![diagram]");
    expect(cleaned).toContain("Fix issue See screenshot:");
  });
});
