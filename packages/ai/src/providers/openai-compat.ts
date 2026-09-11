import { classifyProviderLocation, sanitizeLogString, scanCommitMessage } from "@gitwhisper/core";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VARIANTS, buildUserPrompt } from "../prompt.js";
import {
  AIAuthenticationError,
  AIConnectionError,
  AIModelNotFoundError,
  AIOutputValidationError,
  type AIProvider,
  AIProviderError,
  AIRateLimitError,
  type CommitGenerationRequest,
  type CommitGenerationResult,
  type MultiVariantGenerationResult,
  type ProviderValidation,
} from "../types.js";
import { validateCommitResponse, validateCommitVariantsResponse } from "../validator.js";

export interface OpenAICompatOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export class OpenAICompatProvider implements AIProvider {
  readonly id = "openai-compatible";
  readonly isLocal: boolean;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;

  constructor(options: OpenAICompatOptions) {
    this.baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey?.trim();
    this.model = options.model;

    // Classify provider location using authoritative loopback rules
    this.isLocal = classifyProviderLocation(this.baseUrl) === "local";
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async validateConfiguration(): Promise<ProviderValidation> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: "Authentication failed. Invalid or missing API key.",
          };
        }
        return {
          valid: false,
          error: `Provider returned HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const availableModels = (data.data || []).map((m) => m.id);

      return {
        valid: true,
        availableModels: availableModels.length > 0 ? availableModels : undefined,
      };
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        return {
          valid: false,
          error: `Connection to ${this.baseUrl} timed out.`,
        };
      }
      return {
        valid: false,
        error: `Could not connect to ${this.baseUrl}: ${err.message}`,
      };
    }
  }

  async generateCommitMessage(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<CommitGenerationResult> {
    const userPrompt = buildUserPrompt(request);

    const makeRequest = async (useJsonFormat: boolean) => {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      };

      if (useJsonFormat) {
        body.response_format = { type: "json_object" };
      }

      return fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    };

    let response: Response;
    try {
      response = await makeRequest(true);

      // Gracefully retry without response_format if the compatible provider doesn't support json_object
      if (response.status === 400) {
        const errorText = await response.text().catch(() => "");
        if (errorText.includes("response_format") || errorText.includes("json_object")) {
          response = await makeRequest(false);
        } else {
          throw new AIProviderError(
            `Provider returned HTTP 400 Bad Request: ${errorText}`,
            this.id,
            400,
          );
        }
      }
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      if (err.name === "AbortError") {
        throw new AIProviderError("Commit generation request was cancelled.", this.id);
      }
      throw new AIConnectionError(this.id, this.baseUrl, err);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new AIAuthenticationError(this.id);
      }
      if (response.status === 429) {
        throw new AIRateLimitError(this.id);
      }
      if (response.status === 404) {
        throw new AIModelNotFoundError(this.id, this.model);
      }
      const sanitizedError = sanitizeLogString(
        errorBody || response.statusText,
        this.apiKey ? [this.apiKey] : [],
      );
      throw new AIProviderError(
        `OpenAI-compatible provider returned HTTP ${response.status}: ${sanitizedError}`,
        this.id,
        response.status,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const rawContent = data.choices?.[0]?.message?.content || "";
    const validated = validateCommitResponse(
      rawContent,
      this.id,
      request.allowedTypes,
      request.styleContext?.style,
    );

    // Scan generated message to ensure no secrets or placeholders leaked
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

    const makeRequest = async (useJsonFormat: boolean) => {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_VARIANTS },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      };

      if (useJsonFormat) {
        body.response_format = { type: "json_object" };
      }

      return fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    };

    let response: Response;
    try {
      response = await makeRequest(true);

      // Gracefully retry without response_format if the compatible provider doesn't support json_object
      if (response.status === 400) {
        const errorText = await response.text().catch(() => "");
        if (errorText.includes("response_format") || errorText.includes("json_object")) {
          response = await makeRequest(false);
        } else {
          throw new AIProviderError(
            `Provider returned HTTP 400 Bad Request: ${sanitizeLogString(errorText, this.apiKey ? [this.apiKey] : [])}`,
            this.id,
            400,
          );
        }
      }
    } catch (err: any) {
      if (err instanceof AIProviderError) throw err;
      if (err.name === "AbortError") {
        throw new AIProviderError("Commit generation request was cancelled.", this.id);
      }
      throw new AIConnectionError(this.id, this.baseUrl, err);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new AIAuthenticationError(this.id);
      }
      if (response.status === 429) {
        throw new AIRateLimitError(this.id);
      }
      if (response.status === 404) {
        throw new AIModelNotFoundError(this.id, this.model);
      }
      const sanitizedError = sanitizeLogString(
        errorBody || response.statusText,
        this.apiKey ? [this.apiKey] : [],
      );
      throw new AIProviderError(
        `OpenAI-compatible provider returned HTTP ${response.status}: ${sanitizedError}`,
        this.id,
        response.status,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };

    const rawContent = data.choices?.[0]?.message?.content || "";
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
