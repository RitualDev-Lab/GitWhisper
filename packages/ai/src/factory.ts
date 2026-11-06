import type { ResolvedConfig } from "@gitwhisper/config";
import { AwsBedrockProvider } from "./providers/aws-bedrock.js";
import { AzureOpenAIProvider } from "./providers/azure-openai.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatProvider } from "./providers/openai-compat.js";
import type { AIProvider } from "./types.js";

export interface PrivacyBadge {
  label: string;
  isLocal: boolean;
  description: string;
}

/**
 * Creates the appropriate AI provider instance based on resolved configuration.
 */
export function createProvider(config: ResolvedConfig): AIProvider {
  if (config.provider === "ollama") {
    return new OllamaProvider({
      baseUrl: config.baseUrl,
      model: config.model,
    });
  }

  if (config.provider === "openai-compatible") {
    return new OpenAICompatProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  if ((config.provider as string) === "azure-openai") {
    return new AzureOpenAIProvider({
      endpoint: config.baseUrl,
      deploymentId: config.model,
      apiKey: config.apiKey,
    });
  }

  if ((config.provider as string) === "aws-bedrock") {
    return new AwsBedrockProvider({
      modelId: config.model,
      endpoint: config.baseUrl,
    });
  }

  throw new Error(
    `Unsupported provider: "${config.provider}". Supported: "ollama", "openai-compatible", "azure-openai", "aws-bedrock"`,
  );
}

/**
 * Computes privacy badge and notice for the given provider.
 */
export function getPrivacyBadge(provider: AIProvider): PrivacyBadge {
  if (provider.isLocal) {
    return {
      label: "Local",
      isLocal: true,
      description: "Local — no source code leaves this machine",
    };
  }

  return {
    label: "Remote",
    isLocal: false,
    description: "Remote — staged diff may leave this machine",
  };
}

/**
 * Universal helper that queries an AI provider for multi-variants,
 * seamlessly degrading to synthesized variants if the provider only implements single-commit generation.
 */
export async function generateVariants(
  provider: AIProvider,
  request: Parameters<AIProvider["generateCommitMessage"]>[0],
  signal?: AbortSignal,
) {
  if (provider.generateCommitVariants) {
    return provider.generateCommitVariants(request, signal);
  }

  const single = await provider.generateCommitMessage(request, signal);
  return {
    type: single.type,
    scope: single.scope,
    breaking: single.breaking,
    breakingDescription: single.breakingDescription,
    variants: {
      concise: {
        style: "concise" as const,
        subject: single.subject,
        description: single.description,
      },
      descriptive: {
        style: "descriptive" as const,
        subject: single.subject,
        description: single.description,
        body: single.body,
      },
      detailed: {
        style: "detailed" as const,
        subject: single.subject,
        description: single.description,
        body: single.body,
      },
    },
    reasoning: single.reasoning,
    provider: single.provider,
    model: single.model,
    rawResponse: single.rawResponse,
  };
}
