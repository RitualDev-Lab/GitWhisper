import http from "node:http";
import {
  AIConnectionError,
  AIModelNotFoundError,
  AIOutputValidationError,
  OllamaProvider,
} from "@gitwhisper/ai";
import type { CommitGenerationRequest } from "@gitwhisper/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Ollama Provider Transport & Validation", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  // Configurable server response handlers
  let chatResponseHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  let tagsResponseHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/api/tags" && req.method === "GET") {
        tagsResponseHandler(req, res);
      } else if (req.url === "/api/chat" && req.method === "POST") {
        chatResponseHandler(req, res);
      } else {
        res.statusCode = 404;
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const dummyRequest: CommitGenerationRequest = {
    repository: { name: "test-repo", branch: "main" },
    files: [{ path: "src/auth.ts", status: "modified", additions: 5, deletions: 1, binary: false }],
    stats: { additions: 5, deletions: 1 },
    patch: "+export function login() {}\n",
  };

  it("successfully parses valid JSON response from Ollama", async () => {
    chatResponseHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              subject: "feat(auth): add login function",
              body: "Exports login function for authentication flow.",
            }),
          },
        }),
      );
    };

    const provider = new OllamaProvider({ baseUrl, model: "qwen2.5-coder:7b" });
    const result = await provider.generateCommitMessage(dummyRequest);

    expect(result.subject).toBe("feat(auth): add login function");
    expect(result.body).toBe("Exports login function for authentication flow.");
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("qwen2.5-coder:7b");
  });

  it("handles markdown-fenced JSON responses gracefully", async () => {
    chatResponseHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: '```json\n{"subject": "fix(api): handle timeout error"}\n```',
          },
        }),
      );
    };

    const provider = new OllamaProvider({ baseUrl, model: "qwen2.5-coder:7b" });
    const result = await provider.generateCommitMessage(dummyRequest);
    expect(result.subject).toBe("fix(api): handle timeout error");
  });

  it("throws AIOutputValidationError when model returns invalid JSON (never falls back to fake text)", async () => {
    chatResponseHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: "Here is your commit message: update the auth files",
          },
        }),
      );
    };

    const provider = new OllamaProvider({ baseUrl, model: "qwen2.5-coder:7b" });
    await expect(provider.generateCommitMessage(dummyRequest)).rejects.toThrow(
      AIOutputValidationError,
    );
  });

  it("throws AIOutputValidationError when subject contains newlines", async () => {
    chatResponseHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              subject: "feat(auth): first line\nsecond line",
            }),
          },
        }),
      );
    };

    const provider = new OllamaProvider({ baseUrl, model: "qwen2.5-coder:7b" });
    await expect(provider.generateCommitMessage(dummyRequest)).rejects.toThrow(
      AIOutputValidationError,
    );
  });

  it("validates available models via /api/tags", async () => {
    tagsResponseHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3.2:latest" }],
        }),
      );
    };

    const provider = new OllamaProvider({ baseUrl, model: "qwen2.5-coder:7b" });
    const validation = await provider.validateConfiguration();
    expect(validation.valid).toBe(true);
    expect(validation.availableModels).toContain("qwen2.5-coder:7b");
  });

  it("reports missing model gracefully during validation", async () => {
    tagsResponseHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          models: [{ name: "llama3.2:latest" }],
        }),
      );
    };

    const provider = new OllamaProvider({ baseUrl, model: "non-existent-model" });
    const validation = await provider.validateConfiguration();
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("not installed");
  });

  it("handles connection failure cleanly", async () => {
    // Unused port
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:54321", model: "qwen" });
    await expect(provider.generateCommitMessage(dummyRequest)).rejects.toThrow(AIConnectionError);
  });
});
