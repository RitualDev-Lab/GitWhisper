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

export interface AwsBedrockOptions {
  region?: string;
  modelId?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

/**
 * AWS Bedrock Corporate LLM Gateway
 * Routes commit generation through Amazon Bedrock runtime (Claude 3.5, Llama 3)
 * with corporate IAM role integration.
 */
export class AwsBedrockProvider implements AIProvider {
  readonly id = "aws-bedrock";
  readonly isLocal = false;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly model: string;
  readonly region: string;
  private accessKeyId?: string;
  private secretAccessKey?: string;
  private sessionToken?: string;

  constructor(options: AwsBedrockOptions = {}) {
    this.region = options.region || process.env.AWS_REGION || "us-east-1";
    this.modelId = options.modelId || "anthropic.claude-3-5-sonnet-20241022-v2:0";
    this.model = this.modelId;
    this.baseUrl = options.endpoint || `https://bedrock-runtime.${this.region}.amazonaws.com`;
    this.accessKeyId = options.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = options.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
    this.sessionToken = options.sessionToken || process.env.AWS_SESSION_TOKEN;
  }

  private getInvokeUrl(): string {
    return `${this.baseUrl}/model/${this.modelId}/invoke`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.sessionToken) {
      headers["X-Amz-Security-Token"] = this.sessionToken;
    }
    return headers;
  }

  async validateConfiguration(): Promise<ProviderValidation> {
    if (!this.accessKeyId && !process.env.AWS_ACCESS_KEY_ID) {
      return {
        valid: false,
        error: "AWS Bedrock credentials missing: AWS_ACCESS_KEY_ID or IAM role required.",
      };
    }
    return { valid: true, availableModels: [this.modelId] };
  }

  async generateCommitMessage(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<CommitGenerationResult> {
    const userPrompt = buildUserPrompt(request);

    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
    };

    const rawResponse = await this.invokeModel(payload, signal);
    const parsed = validateCommitResponse(
      rawResponse,
      this.id,
      request.allowedTypes,
      request.styleContext?.style,
    );

    const messageScan = await scanCommitMessage(parsed.subject, parsed.body);
    if (!messageScan.safe) {
      throw new AIOutputValidationError(
        `AWS Bedrock response contained sensitive data: ${messageScan.reasons.join("; ")}`,
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
      model: this.modelId,
      rawResponse,
    };
  }

  async generateCommitVariants(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<MultiVariantGenerationResult> {
    const userPrompt = buildUserPrompt(request);
    const payload = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1500,
      system: SYSTEM_PROMPT_VARIANTS,
      messages: [{ role: "user", content: userPrompt }],
      temperature: 0.2,
    };

    const rawResponse = await this.invokeModel(payload, signal);
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
            `AWS Bedrock variant leaked sensitive data: ${messageScan.reasons.join("; ")}`,
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
      model: this.modelId,
      rawResponse,
    };
  }

  private async invokeModel(payload: unknown, signal?: AbortSignal): Promise<string> {
    const url = this.getInvokeUrl();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AIAuthenticationError(this.id);
        }
        if (response.status === 404) {
          throw new AIModelNotFoundError(this.id, this.modelId);
        }
        if (response.status === 429) {
          throw new AIRateLimitError(this.id);
        }
        throw new AIProviderError(
          `AWS Bedrock returned HTTP ${response.status}: ${response.statusText}`,
          this.id,
          response.status,
        );
      }

      const json = (await response.json()) as {
        content?: Array<{ text?: string }>;
      };
      const text = json.content?.[0]?.text;
      if (!text) {
        throw new AIOutputValidationError(
          "AWS Bedrock returned empty response content",
          this.id,
          "",
        );
      }
      return text;
    } catch (err: unknown) {
      if (err instanceof AIProviderError) throw err;
      throw new AIConnectionError(this.id, url, err instanceof Error ? err : undefined);
    }
  }
}
