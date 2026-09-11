import readline from "node:readline/promises";
import { OllamaProvider, OpenAICompatProvider } from "@gitwhisper/ai";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENAI_COMPAT_BASE_URL,
  DEFAULT_OPENAI_COMPAT_MODEL,
  type GitWhisperConfig,
  type ProviderType,
  loadConfig,
  saveConfig,
} from "@gitwhisper/config";
import { colors, printHeader } from "../ui/terminal.js";

export async function runConfigWizard(): Promise<void> {
  printHeader();
  console.log(` ${colors.bold}GitWhisper Setup${colors.reset}`);
  console.log(
    ` ${colors.dim}GitWhisper is local-first & BYOK. No RitualDev credentials or accounts required.${colors.reset}\n`,
  );

  const currentConfig = await loadConfig();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(" Choose AI provider:");
    console.log("  1. Ollama (Local AI)");
    console.log("  2. OpenAI-Compatible (BYOK)\n");

    const defaultChoice = currentConfig.provider === "openai-compatible" ? "2" : "1";
    const providerChoice =
      (await rl.question(` Select [${defaultChoice}]: `)).trim() || defaultChoice;

    const provider: ProviderType = providerChoice === "2" ? "openai-compatible" : "ollama";

    if (provider === "ollama") {
      console.log(`\n ${colors.bold}Configuring Ollama (Local)${colors.reset}`);
      const baseUrlAnswer = await rl.question(
        ` Ollama Endpoint [${currentConfig.baseUrl || DEFAULT_OLLAMA_BASE_URL}]: `,
      );
      const baseUrl = baseUrlAnswer.trim() || currentConfig.baseUrl || DEFAULT_OLLAMA_BASE_URL;

      console.log(`\n ${colors.dim}Checking Ollama at ${baseUrl}...${colors.reset}`);
      const testProvider = new OllamaProvider({ baseUrl, model: DEFAULT_OLLAMA_MODEL });
      const validation = await testProvider.validateConfiguration();

      let selectedModel = DEFAULT_OLLAMA_MODEL;
      if (validation.valid && validation.availableModels && validation.availableModels.length > 0) {
        console.log(
          ` ${colors.green}✓${colors.reset} Connected to Ollama (${validation.availableModels.length} models detected)`,
        );
        console.log("\n Available models:");
        validation.availableModels.slice(0, 8).forEach((m, idx) => {
          console.log(`  ${idx + 1}. ${m}`);
        });

        const modelAnswer = await rl.question(
          `\n Choose model [${validation.availableModels[0]}]: `,
        );
        const trimmed = modelAnswer.trim();
        const num = Number.parseInt(trimmed, 10);
        if (!Number.isNaN(num) && num > 0 && num <= validation.availableModels.length) {
          selectedModel = validation.availableModels[num - 1];
        } else if (trimmed) {
          selectedModel = trimmed;
        } else {
          selectedModel = validation.availableModels[0];
        }
      } else {
        console.log(
          ` ${colors.yellow}⚠${colors.reset} Could not auto-detect models (${validation.error || "unavailable"}).`,
        );
        const modelAnswer = await rl.question(
          ` Model name [${currentConfig.model || DEFAULT_OLLAMA_MODEL}]: `,
        );
        selectedModel = modelAnswer.trim() || currentConfig.model || DEFAULT_OLLAMA_MODEL;
      }

      const updates: Partial<GitWhisperConfig> = {
        provider: "ollama",
        model: selectedModel,
        providers: {
          ollama: {
            baseUrl,
          },
        },
      };

      const savedPath = await saveConfig(updates);
      console.log(`\n ${colors.green}✓${colors.reset} Configuration saved to ${savedPath}`);
      console.log(
        ` ${colors.green}✓${colors.reset} Privacy: Local — no source code will leave your machine.`,
      );
    } else {
      console.log(`\n ${colors.bold}Configuring OpenAI-Compatible Endpoint (BYOK)${colors.reset}`);
      const baseUrlAnswer = await rl.question(
        ` Base URL [${currentConfig.baseUrl || DEFAULT_OPENAI_COMPAT_BASE_URL}]: `,
      );
      const baseUrl =
        baseUrlAnswer.trim() || currentConfig.baseUrl || DEFAULT_OPENAI_COMPAT_BASE_URL;

      const modelAnswer = await rl.question(
        ` Model name [${currentConfig.model || DEFAULT_OPENAI_COMPAT_MODEL}]: `,
      );
      const model = modelAnswer.trim() || currentConfig.model || DEFAULT_OPENAI_COMPAT_MODEL;

      console.log("\n API Key:");
      console.log(
        "  You can provide an API key here, or leave blank and set GITWHISPER_API_KEY environment variable.",
      );
      const apiKeyAnswer = await rl.question(" API Key (leave empty to skip): ");
      const apiKey = apiKeyAnswer.trim() || undefined;

      const updates: Partial<GitWhisperConfig> = {
        provider: "openai-compatible",
        model,
        providers: {
          "openai-compatible": {
            baseUrl,
            ...(apiKey ? { apiKey } : {}),
          },
        },
      };

      const savedPath = await saveConfig(updates);
      console.log(`\n ${colors.green}✓${colors.reset} Configuration saved to ${savedPath}`);
      console.log(
        ` ${colors.yellow}⚠${colors.reset} Privacy: Remote — staged diffs may leave this machine when using remote endpoints.`,
      );
    }
  } finally {
    rl.close();
  }
}
