import { classifyProviderLocation } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 7 Endpoint Classifier", () => {
  it("classifies loopback endpoints strictly as 'local'", () => {
    expect(classifyProviderLocation("http://localhost:11434")).toBe("local");
    expect(classifyProviderLocation("http://127.0.0.1:11434")).toBe("local");
    expect(classifyProviderLocation("http://127.0.0.99:8000")).toBe("local");
    expect(classifyProviderLocation("http://[::1]:11434")).toBe("local");
    expect(classifyProviderLocation("http://0.0.0.0:11434")).toBe("local");
    expect(classifyProviderLocation("localhost:11434")).toBe("local");
    expect(classifyProviderLocation("127.0.0.1:8080")).toBe("local");
  });

  it("classifies LAN, public IPs, and remote hostnames as 'remote'", () => {
    expect(classifyProviderLocation("https://api.openai.com/v1")).toBe("remote");
    expect(classifyProviderLocation("https://api.groq.com/openai/v1")).toBe("remote");
    expect(classifyProviderLocation("http://192.168.1.100:11434")).toBe("remote");
    expect(classifyProviderLocation("http://10.0.0.1:8000")).toBe("remote");
    expect(classifyProviderLocation("http://172.16.0.5:11434")).toBe("remote");
    expect(classifyProviderLocation("http://my-gpu-server.local:11434")).toBe("remote");
    expect(classifyProviderLocation("https://internal-llm.company.com")).toBe("remote");
  });

  it("handles malformed inputs safely as 'unknown'", () => {
    expect(classifyProviderLocation("")).toBe("unknown");
    // @ts-expect-error test invalid input
    expect(classifyProviderLocation(null)).toBe("unknown");
  });
});
