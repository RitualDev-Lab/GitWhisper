import type { ResolvedConfig } from "@gitwhisper/config";
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

  throw new Error(
    `Unsupported provider: "${config.provider}". Supported: "ollama", "openai-compatible"`,
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
  request: import("./types.js").CommitGenerationRequest,
  signal?: AbortSignal,
): Promise<import("./types.js").MultiVariantGenerationResult> {
  if (typeof provider.generateCommitVariants === "function") {
    return provider.generateCommitVariants(request, signal);
  }

  const single = await provider.generateCommitMessage(request, signal);
  const { validateCommitVariantsResponse } = await import("./validator.js");
  return validateCommitVariantsResponse(
    JSON.stringify(single),
    provider.id,
    request.allowedTypes,
    request.styleContext?.style,
  );
}
