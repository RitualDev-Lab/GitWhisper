import http from "node:http";
import {
  AIAuthenticationError,
  AIRateLimitError,
  type CommitGenerationRequest,
  OpenAICompatProvider,
} from "@gitwhisper/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("OpenAI-Compatible BYOK Adapter Transport & Validation", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  let completionsHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};
  const modelsHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/models" && req.method === "GET") {
        modelsHandler(req, res);
      } else if (req.url === "/chat/completions" && req.method === "POST") {
        completionsHandler(req, res);
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
    files: [{ path: "src/db.ts", status: "modified", additions: 10, deletions: 2, binary: false }],
    stats: { additions: 10, deletions: 2 },
    patch: "+export function connect() {}\n",
  };

  it("detects local loopback addresses correctly", () => {
    const local = new OpenAICompatProvider({ baseUrl: "http://127.0.0.1:1234/v1", model: "m" });
    expect(local.isLocal).toBe(true);

    const remote = new OpenAICompatProvider({ baseUrl: "https://api.openai.com/v1", model: "m" });
    expect(remote.isLocal).toBe(false);
  });

  it("successfully parses valid completions response", async () => {
    completionsHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subject: "feat(db): implement connection pooling",
                  body: "Optimizes database connections for high concurrency.",
                }),
              },
            },
          ],
        }),
      );
    };

    const provider = new OpenAICompatProvider({ baseUrl, model: "gpt-4o-mini", apiKey: "sk-test" });
    const result = await provider.generateCommitMessage(dummyRequest);

    expect(result.subject).toBe("feat(db): implement connection pooling");
    expect(result.body).toBe("Optimizes database connections for high concurrency.");
    expect(result.provider).toBe("openai-compatible");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("handles 401 Unauthorized as AIAuthenticationError", async () => {
    completionsHandler = (_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
    };

    const provider = new OpenAICompatProvider({ baseUrl, model: "gpt-4o-mini", apiKey: "sk-bad" });
    await expect(provider.generateCommitMessage(dummyRequest)).rejects.toThrow(
      AIAuthenticationError,
    );
  });

  it("handles 429 Rate Limit as AIRateLimitError", async () => {
    completionsHandler = (_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Rate limit exceeded" } }));
    };

    const provider = new OpenAICompatProvider({ baseUrl, model: "gpt-4o-mini", apiKey: "sk-test" });
    await expect(provider.generateCommitMessage(dummyRequest)).rejects.toThrow(AIRateLimitError);
  });

  it("retries without response_format when provider returns 400 json_object error", async () => {
    let callCount = 0;
    completionsHandler = (req, res) => {
      callCount++;
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        if (parsed.response_format && callCount === 1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unsupported parameter: response_format" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      subject: "fix: retry success without response format",
                    }),
                  },
                },
              ],
            }),
          );
        }
      });
    };

    const provider = new OpenAICompatProvider({ baseUrl, model: "custom-local-model" });
    const result = await provider.generateCommitMessage(dummyRequest);

    expect(callCount).toBe(2);
    expect(result.subject).toBe("fix: retry success without response format");
  });
});
