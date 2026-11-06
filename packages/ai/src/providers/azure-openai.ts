import { scanCommitMessage } from "@gitwhisper/core";
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

export interface AzureOpenAIOptions {
  endpoint: string;
  deploymentId: string;
  apiKey?: string;
  apiVersion?: string;
}

/**
 * Azure OpenAI Service Corporate LLM Gateway
 * Routes commit generation through enterprise private tenant endpoints with api-key or managed identity.
 */
export class AzureOpenAIProvider implements AIProvider {
  readonly id = "azure-openai";
  readonly isLocal = false;
  readonly baseUrl: string;
  readonly deploymentId: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly apiVersion: string;

  constructor(options: AzureOpenAIOptions) {
    this.baseUrl = (options.endpoint || "https://corporate.openai.azure.com").replace(/\/+$/, "");
    this.deploymentId = options.deploymentId || "gpt-4o";
    this.model = this.deploymentId;
    this.apiKey = options.apiKey?.trim();
    this.apiVersion = options.apiVersion || "2024-02-15-preview";
  }

  private getChatCompletionsUrl(): string {
    return `${this.baseUrl}/openai/deployments/${this.deploymentId}/chat/completions?api-version=${this.apiVersion}`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["api-key"] = this.apiKey;
    }
    return headers;
  }

  async validateConfiguration(): Promise<ProviderValidation> {
    try {
      const response = await fetch(this.getChatCompletionsUrl(), {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: "Azure OpenAI authentication failed: Invalid or missing api-key.",
          };
        }
        if (response.status === 404) {
          return {
            valid: false,
            error: `Azure OpenAI deployment '${this.deploymentId}' not found at ${this.baseUrl}.`,
          };
        }
        return {
          valid: false,
          error: `Azure OpenAI endpoint returned HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return { valid: true, availableModels: [this.deploymentId] };
    } catch (err: unknown) {
      return {
        valid: false,
        error: `Could not connect to Azure OpenAI at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async generateCommitMessage(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<CommitGenerationResult> {
    const userPrompt = buildUserPrompt(request);
    const body = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const rawResponse = await this.executeChatCompletion(body, signal);
    const parsed = validateCommitResponse(
      rawResponse,
      this.id,
      request.allowedTypes,
      request.styleContext?.style,
    );

    const messageScan = await scanCommitMessage(parsed.subject, parsed.body);
    if (!messageScan.safe) {
      throw new AIOutputValidationError(
        `Azure OpenAI response contained sensitive data: ${messageScan.reasons.join("; ")}`,
        this.id,
        rawResponse,
      );
    }

    return {
      type: parsed.type,
      scope: parsed.scope,
      description: parsed.description,
      subject: parsed.subject,
      body: parsed.body,
      breaking: parsed.breaking,
      breakingDescription: parsed.breakingDescription,
      reasoning: parsed.reasoning,
      provider: this.id,
      model: this.deploymentId,
      rawResponse,
    };
  }

  async generateCommitVariants(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<MultiVariantGenerationResult> {
    const userPrompt = buildUserPrompt(request);
    const body = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT_VARIANTS },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const rawResponse = await this.executeChatCompletion(body, signal);
    const parsed = validateCommitVariantsResponse(
      rawResponse,
      this.id,
      request.allowedTypes,
      request.styleContext?.style,
    );

    for (const style of ["concise", "descriptive", "detailed"] as const) {
      const variant = parsed.variants[style];
      if (variant) {
        const messageScan = await scanCommitMessage(variant.subject, variant.body);
        if (!messageScan.safe) {
          throw new AIOutputValidationError(
            `Azure OpenAI variant leaked sensitive data: ${messageScan.reasons.join("; ")}`,
            this.id,
            rawResponse,
          );
        }
      }
    }

    return {
      type: parsed.type,
      scope: parsed.scope,
      breaking: parsed.breaking,
      breakingDescription: parsed.breakingDescription,
      variants: parsed.variants,
      reasoning: parsed.reasoning,
      provider: this.id,
      model: this.deploymentId,
      rawResponse,
    };
  }

  private async executeChatCompletion(body: unknown, signal?: AbortSignal): Promise<string> {
    const url = this.getChatCompletionsUrl();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AIAuthenticationError(this.id);
        }
        if (response.status === 404) {
          throw new AIModelNotFoundError(this.id, this.deploymentId);
        }
        if (response.status === 429) {
          throw new AIRateLimitError(this.id);
        }
        throw new AIProviderError(
          `Azure OpenAI returned HTTP ${response.status}: ${response.statusText}`,
          this.id,
          response.status,
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new AIOutputValidationError(
          "Azure OpenAI returned empty completion content",
          this.id,
          "",
        );
      }
      return content;
    } catch (err: unknown) {
      if (err instanceof AIProviderError) throw err;
      throw new AIConnectionError(this.id, url, err instanceof Error ? err : undefined);
    }
  }
}
