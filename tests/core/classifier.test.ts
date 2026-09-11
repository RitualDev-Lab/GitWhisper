import { classifyFilePath } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Deterministic File Classifier", () => {
  it("classifies test files correctly", () => {
    expect(classifyFilePath("src/auth.test.ts")).toBe("test");
    expect(classifyFilePath("src/auth.spec.js")).toBe("test");
    expect(classifyFilePath("tests/session.ts")).toBe("test");
    expect(classifyFilePath("__tests__/user.ts")).toBe("test");
    expect(classifyFilePath("pkg/service_test.go")).toBe("test");
    expect(classifyFilePath("test_api.py")).toBe("test");
  });

  it("classifies documentation files correctly", () => {
    expect(classifyFilePath("README.md")).toBe("documentation");
    expect(classifyFilePath("readme.txt")).toBe("documentation");
    expect(classifyFilePath("docs/architecture.md")).toBe("documentation");
    expect(classifyFilePath("LICENSE")).toBe("documentation");
    expect(classifyFilePath("CONTRIBUTING.md")).toBe("documentation");
  });

  it("classifies dependency files correctly", () => {
    expect(classifyFilePath("package.json")).toBe("dependency");
    expect(classifyFilePath("pnpm-lock.yaml")).toBe("dependency");
    expect(classifyFilePath("yarn.lock")).toBe("dependency");
    expect(classifyFilePath("Cargo.toml")).toBe("dependency");
    expect(classifyFilePath("requirements.txt")).toBe("dependency");
    expect(classifyFilePath("go.mod")).toBe("dependency");
  });

  it("classifies configuration files correctly", () => {
    expect(classifyFilePath("tsconfig.json")).toBe("configuration");
    expect(classifyFilePath("tsconfig.base.json")).toBe("configuration");
    expect(classifyFilePath("biome.json")).toBe("configuration");
    expect(classifyFilePath(".eslintrc.js")).toBe("configuration");
    expect(classifyFilePath("vite.config.ts")).toBe("configuration");
    expect(classifyFilePath("Dockerfile")).toBe("configuration");
    expect(classifyFilePath("docker-compose.yml")).toBe("configuration");
    expect(classifyFilePath(".github/workflows/ci.yml")).toBe("configuration");
  });

  it("classifies binary files correctly", () => {
    expect(classifyFilePath("logo.png")).toBe("binary");
    expect(classifyFilePath("favicon.ico")).toBe("binary");
    expect(classifyFilePath("module.wasm")).toBe("binary");
    expect(classifyFilePath("custom.custom", true)).toBe("binary");
  });

  it("classifies source files correctly", () => {
    expect(classifyFilePath("src/auth/session.ts")).toBe("source");
    expect(classifyFilePath("lib/math.py")).toBe("source");
    expect(classifyFilePath("main.go")).toBe("source");
  });
});
