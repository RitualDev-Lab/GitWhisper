import { classifyProviderLocation, sanitizeLogString, scanCommitMessage } from "@gitwhisper/core";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VARIANTS, buildUserPrompt } from "../prompt.js";
import {
  AIConnectionError,
  AIModelNotFoundError,
  AIOutputValidationError,
  type AIProvider,
  AIProviderError,
  type CommitGenerationRequest,
  type CommitGenerationResult,
  type MultiVariantGenerationResult,
  type ProviderValidation,
} from "../types.js";
import { validateCommitResponse, validateCommitVariantsResponse } from "../validator.js";

export interface OllamaProviderOptions {
  baseUrl?: string;
  model: string;
}

export class OllamaProvider implements AIProvider {
  readonly id = "ollama";
  readonly isLocal: boolean;
  readonly baseUrl: string;
  readonly model: string;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = (options.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    this.model = options.model;
    this.isLocal = classifyProviderLocation(this.baseUrl) === "local";
  }

  async validateConfiguration(): Promise<ProviderValidation> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return {
          valid: false,
          error: `Ollama returned HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const availableModels = (data.models || []).map((m) => m.name);

      const hasModel = availableModels.some(
        (name) =>
          name === this.model ||
          name.startsWith(`${this.model}:`) ||
          `${name}:latest` === this.model,
      );

      if (!hasModel && availableModels.length > 0) {
        return {
          valid: false,
          error: `Model "${this.model}" is not installed in Ollama.`,
          availableModels,
        };
      }

      return {
        valid: true,
        availableModels,
      };
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return {
          valid: false,
          error: `Connection to Ollama at ${this.baseUrl} timed out.`,
        };
      }
      return {
        valid: false,
        error: `Could not reach Ollama at ${this.baseUrl}: ${err.message}`,
      };
    }
  }

  async generateCommitMessage(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<CommitGenerationResult> {
    const userPrompt = buildUserPrompt(request);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          format: "json",
          stream: false,
          options: {
            temperature: 0.2,
          },
        }),
        signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new AIProviderError("Commit generation request was cancelled.", this.id);
      }
      throw new AIConnectionError(this.id, this.baseUrl, err);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new AIModelNotFoundError(this.id, this.model);
      }
      const sanitizedError = sanitizeLogString(errorBody || response.statusText);
      throw new AIProviderError(
        `Ollama returned HTTP ${response.status}: ${sanitizedError}`,
        this.id,
        response.status,
      );
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };

    const rawContent = data.message?.content || data.response || "";
    const validated = validateCommitResponse(
      rawContent,
      this.id,
      request.allowedTypes,
      request.styleContext?.style,
    );

    // Scan generated message
    const messageScan = await scanCommitMessage(validated.subject, validated.body);
    if (!messageScan.safe) {
      throw new AIOutputValidationError(
        `Model response leaked sensitive data or unresolved placeholders: ${messageScan.reasons.join("; ")}`,
        this.id,
        rawContent,
      );
    }

    return {
      type: validated.type,
      scope: validated.scope,
      description: validated.description,
      subject: validated.subject,
      body: validated.body,
      breaking: validated.breaking,
      breakingDescription: validated.breakingDescription,
      reasoning: validated.reasoning,
      provider: this.id,
      model: this.model,
      rawResponse: rawContent,
    };
  }

  async generateCommitVariants(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<MultiVariantGenerationResult> {
    const userPrompt = buildUserPrompt(request);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_VARIANTS },
            { role: "user", content: userPrompt },
          ],
          format: "json",
          stream: false,
          options: {
            temperature: 0.2,
          },
        }),
        signal,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new AIProviderError("Commit generation request was cancelled.", this.id);
      }
      throw new AIConnectionError(this.id, this.baseUrl, err);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new AIModelNotFoundError(this.id, this.model);
      }
      const sanitizedError = sanitizeLogString(errorBody || response.statusText);
      throw new AIProviderError(
        `Ollama returned HTTP ${response.status}: ${sanitizedError}`,
        this.id,
        response.status,
      );
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };

    const rawContent = data.message?.content || data.response || "";
    const validated = validateCommitVariantsResponse(
      rawContent,
      this.id,
      request.allowedTypes,
      request.styleContext?.style,
    );

    // Scan each variant
    for (const style of ["concise", "descriptive", "detailed"] as const) {
      const variant = validated.variants[style];
      if (variant) {
        const messageScan = await scanCommitMessage(variant.subject, variant.body);
        if (!messageScan.safe) {
          throw new AIOutputValidationError(
            `Model response variant "${style}" leaked sensitive data or unresolved placeholders: ${messageScan.reasons.join("; ")}`,
            this.id,
            rawContent,
          );
        }
      }
    }

    return {
      ...validated,
      provider: this.id,
      model: this.model,
      rawResponse: rawContent,
    };
  }
}
