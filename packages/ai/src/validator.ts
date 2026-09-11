import { AIOutputValidationError, type MultiVariantGenerationResult } from "./types.js";

interface RawCommitJson {
  type?: unknown;
  scope?: unknown;
  description?: unknown;
  subject?: unknown;
  body?: unknown;
  breaking?: unknown;
  breakingDescription?: unknown;
  reasoning?: unknown;
}

export interface ValidatedCommitMessage {
  type: string;
  scope?: string;
  description: string;
  subject: string;
  body?: string;
  breaking: boolean;
  breakingDescription?: string;
  reasoning: string[];
}

/**
 * Extracts and validates structured Conventional Commit JSON from raw LLM output.
 * Ensures the response strictly adheres to candidate constraints and formatting rules.
 */
export function validateCommitResponse(
  rawOutput: string,
  providerId: string,
  allowedTypes?: string[],
  expectedStyle: "conventional" | "simple" = "conventional",
): ValidatedCommitMessage {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new AIOutputValidationError("Empty output received from model.", providerId, rawOutput);
  }

  // Strip Markdown code fences if the model wrapped output in ```json ... ```
  let jsonString = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    jsonString = fenceMatch[1].trim();
  } else {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonString = trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: RawCommitJson;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    throw new AIOutputValidationError(
      `Failed to parse response as JSON: ${err.message}`,
      providerId,
      rawOutput,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AIOutputValidationError("Parsed JSON root is not an object.", providerId, rawOutput);
  }

  let type = typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";
  let scope = typeof parsed.scope === "string" ? parsed.scope.trim().toLowerCase() : undefined;
  if (scope === "" || scope === "none") {
    scope = undefined;
  }

  let description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  const breaking = parsed.breaking === true;
  const breakingDescription =
    typeof parsed.breakingDescription === "string" ? parsed.breakingDescription.trim() : undefined;

  // If parsed has legacy 'subject' field instead of type/description:
  if (!description && typeof parsed.subject === "string" && parsed.subject.trim()) {
    const subjectLine = parsed.subject.trim();
    if (expectedStyle === "simple") {
      description = subjectLine;
    } else {
      // Parse Conventional Commit regex: type(scope)!: description or type!: description
      const match = subjectLine.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
      if (match) {
        type = match[1].toLowerCase();
        scope = match[2]?.trim().toLowerCase();
        if (scope === "" || scope === "none") scope = undefined;
        description = match[4].trim();
      } else {
        type = "chore";
        description = subjectLine;
      }
    }
  }

  if (expectedStyle === "simple") {
    if (!type) {
      type = "simple";
    }
  } else {
    if (!type) {
      throw new AIOutputValidationError(
        'Missing or invalid "type" in JSON response.',
        providerId,
        rawOutput,
      );
    }

    if (allowedTypes && allowedTypes.length > 0) {
      const normalizedAllowed = allowedTypes.map((t) => t.toLowerCase());
      if (!normalizedAllowed.includes(type)) {
        throw new AIOutputValidationError(
          `Returned type "${type}" is not in the allowed types list: [${normalizedAllowed.join(", ")}].`,
          providerId,
          rawOutput,
        );
      }
    }
  }

  if (!description) {
    throw new AIOutputValidationError(
      'Missing or invalid "description" in JSON response.',
      providerId,
      rawOutput,
    );
  }

  // Description cannot contain newlines
  if (description.includes("\n") || description.includes("\r")) {
    throw new AIOutputValidationError(
      'Commit "description" must be a single line without newlines.',
      providerId,
      rawOutput,
    );
  }

  // Strip trailing period from description
  description = description.replace(/\.$/, "");

  // Format canonical subject
  let subject: string;
  if (expectedStyle === "simple") {
    subject = description;
  } else {
    const breakingMarker = breaking ? "!" : "";
    subject = scope
      ? `${type}(${scope})${breakingMarker}: ${description}`
      : `${type}${breakingMarker}: ${description}`;
  }

  let body: string | undefined;
  if (parsed.body !== undefined && parsed.body !== null) {
    if (typeof parsed.body !== "string") {
      throw new AIOutputValidationError(
        'Commit "body" must be a string if provided.',
        providerId,
        rawOutput,
      );
    }
    const trimmedBody = parsed.body.trim();
    if (trimmedBody.length > 0) {
      body = trimmedBody;
    }
  }

  const reasoning: string[] = Array.isArray(parsed.reasoning)
    ? parsed.reasoning.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : [];

  return {
    type,
    scope,
    description,
    subject,
    body,
    breaking,
    breakingDescription,
    reasoning,
  };
}

/**
 * Extracts, normalizes and validates 3 distinct commit variants (concise, descriptive, detailed)
 * from raw LLM output. Fallbacks to robust synthesis if only partial or single-variant JSON is returned.
 */
export function validateCommitVariantsResponse(
  rawOutput: string,
  providerId: string,
  allowedTypes?: string[],
  expectedStyle: "conventional" | "simple" = "conventional",
): MultiVariantGenerationResult {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new AIOutputValidationError("Empty output received from model.", providerId, rawOutput);
  }

  // Strip Markdown code fences if the model wrapped output in ```json ... ```
  let jsonString = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    jsonString = fenceMatch[1].trim();
  } else {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonString = trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    throw new AIOutputValidationError(
      `Failed to parse response as JSON: ${err.message}`,
      providerId,
      rawOutput,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AIOutputValidationError("Parsed JSON root is not an object.", providerId, rawOutput);
  }

  let type = typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";
  let scope = typeof parsed.scope === "string" ? parsed.scope.trim().toLowerCase() : undefined;
  if (scope === "" || scope === "none") {
    scope = undefined;
  }
  let description = typeof parsed.description === "string" ? parsed.description.trim() : "";

  // If parsed has legacy 'subject' field instead of type/description:
  if (!description && typeof parsed.subject === "string" && parsed.subject.trim()) {
    const subjectLine = parsed.subject.trim();
    if (expectedStyle === "simple") {
      description = subjectLine;
    } else {
      const match = subjectLine.match(/^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
      if (match) {
        if (!type) type = match[1].toLowerCase();
        if (!scope) scope = match[2]?.trim().toLowerCase();
        if (scope === "" || scope === "none") scope = undefined;
        description = match[4].trim();
      } else {
        description = subjectLine;
      }
    }
  }

  const breaking = parsed.breaking === true;
  const breakingDescription =
    typeof parsed.breakingDescription === "string" ? parsed.breakingDescription.trim() : undefined;
  const reasoning: string[] = Array.isArray(parsed.reasoning)
    ? (parsed.reasoning as any[]).filter(
        (r: any): r is string => typeof r === "string" && r.trim().length > 0,
      )
    : [];

  // Validate type
  if (expectedStyle === "simple") {
    if (!type) {
      type = "simple";
    }
  } else {
    if (!type) {
      type = "chore";
    }
    if (allowedTypes && allowedTypes.length > 0) {
      const normalizedAllowed = allowedTypes.map((t) => t.toLowerCase());
      if (!normalizedAllowed.includes(type)) {
        type = normalizedAllowed[0] || "chore";
      }
    }
  }

  const formatSubject = (desc: string) => {
    if (expectedStyle === "simple") return desc;
    const breakingMarker = breaking ? "!" : "";
    return scope
      ? `${type}(${scope})${breakingMarker}: ${desc}`
      : `${type}${breakingMarker}: ${desc}`;
  };

  const sanitizeDesc = (desc: string) => {
    return desc
      .split(/[\r\n]+/)[0]
      .trim()
      .replace(/\.$/, "");
  };

  // Check if parsed has variants object
  const variantsObj = parsed.variants;
  let conciseDesc =
    typeof variantsObj?.concise?.description === "string"
      ? sanitizeDesc(variantsObj.concise.description)
      : "";
  let descriptiveDesc =
    typeof variantsObj?.descriptive?.description === "string"
      ? sanitizeDesc(variantsObj.descriptive.description)
      : "";
  let detailedDesc =
    typeof variantsObj?.detailed?.description === "string"
      ? sanitizeDesc(variantsObj.detailed.description)
      : "";

  let conciseBody =
    typeof variantsObj?.concise?.body === "string" ? variantsObj.concise.body.trim() : undefined;
  let descriptiveBody =
    typeof variantsObj?.descriptive?.body === "string"
      ? variantsObj.descriptive.body.trim()
      : undefined;
  let detailedBody =
    typeof variantsObj?.detailed?.body === "string" ? variantsObj.detailed.body.trim() : undefined;

  // Fallback if top-level description exists
  const topDesc = description ? sanitizeDesc(description) : "";
  const topBody =
    typeof parsed.body === "string" && parsed.body.trim().length > 0
      ? parsed.body.trim()
      : undefined;

  if (!descriptiveDesc && topDesc) {
    descriptiveDesc = topDesc;
  }
  if (!descriptiveBody && topBody) {
    descriptiveBody = topBody;
  }

  // If descriptiveDesc is still empty, try whatever is available
  if (!descriptiveDesc) {
    descriptiveDesc = conciseDesc || detailedDesc || "update staged changes";
  }

  // Synthesize concise if missing or empty
  if (!conciseDesc) {
    conciseDesc = descriptiveDesc;
    if (conciseDesc.length > 45) {
      const commaIdx = conciseDesc.indexOf(",");
      const semiIdx = conciseDesc.indexOf(";");
      const cutIdx = Math.min(...[commaIdx, semiIdx].filter((i) => i > 10));
      if (Number.isFinite(cutIdx) && cutIdx > 0) {
        conciseDesc = conciseDesc.slice(0, cutIdx).trim();
      }
    }
  }
  // Concise body should always be empty
  conciseBody = undefined;

  // Synthesize detailed if missing or empty
  if (!detailedDesc) {
    detailedDesc = descriptiveDesc;
  }
  if (!detailedBody) {
    if (descriptiveBody) {
      detailedBody = descriptiveBody;
    } else if (reasoning.length > 0) {
      detailedBody = reasoning.map((r) => `- ${r}`).join("\n");
    }
  }

  return {
    type,
    scope,
    breaking,
    breakingDescription,
    variants: {
      concise: {
        style: "concise",
        description: conciseDesc,
        subject: formatSubject(conciseDesc),
        body: undefined,
      },
      descriptive: {
        style: "descriptive",
        description: descriptiveDesc,
        subject: formatSubject(descriptiveDesc),
        body: descriptiveBody && descriptiveBody.length > 0 ? descriptiveBody : undefined,
      },
      detailed: {
        style: "detailed",
        description: detailedDesc,
        subject: formatSubject(detailedDesc),
        body: detailedBody && detailedBody.length > 0 ? detailedBody : undefined,
      },
    },
    reasoning,
    provider: providerId,
    model: typeof parsed.model === "string" ? parsed.model : "unknown",
    rawResponse: rawOutput,
  };
}
