import path from "node:path";
import type { GitFileChange } from "@gitwhisper/git";
import type { ClassifiedFileChange, FileCategory } from "./types.js";

const TEST_PATTERNS = [
  /\.(test|spec)\.[a-zA-Z0-9]+$/i,
  /(^|[/\\])(tests?|__tests__|testing)[/\\]/i,
  /Test\.(java|kt|scala)$/,
  /_test\.(go|py|rb|rs)$/,
  /^test_.*\.py$/,
];

const DOC_PATTERNS = [
  /^readme(\..+)?$/i,
  /^license(\..+)?$/i,
  /^contributing(\..+)?$/i,
  /^changelog(\..+)?$/i,
  /^code_of_conduct(\..+)?$/i,
  /(^|[/\\])docs?[/\\]/i,
  /\.(md|mdx|markdown|rst|txt)$/i,
];

const DEPENDENCY_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "cargo.toml",
  "cargo.lock",
  "go.mod",
  "go.sum",
  "requirements.txt",
  "pipfile",
  "pipfile.lock",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "composer.lock",
  "gemfile",
  "gemfile.lock",
]);

const CONFIG_PATTERNS = [
  /^tsconfig.*\.json$/i,
  /^\.?(eslint|prettier|biome|stylelint|babel)/i,
  /^(vite|webpack|rollup|tsup|esbuild|vitest|jest|playwright|cypress)\.config\./i,
  /(^|[/\\])\.github[/\\]/i,
  /^dockerfile/i,
  /^docker-compose/i,
  /^\.(gitignore|gitattributes|editorconfig|npmrc)$/i,
  /^\.env(\..+)?$/i,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".svg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".ttf",
  ".woff",
  ".woff2",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
]);

/**
 * Classifies a single file path into a deterministic category.
 */
export function classifyFilePath(filePath: string, isBinary = false): FileCategory {
  if (isBinary) {
    return "binary";
  }

  // Normalize slashes
  const normalized = filePath.replace(/\\/g, "/");
  const filename = path.posix.basename(normalized).toLowerCase();
  const ext = path.posix.extname(normalized).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
    return "binary";
  }

  // Test patterns
  for (const pattern of TEST_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(filename)) {
      return "test";
    }
  }

  // Dependencies (checked before generic documentation like .txt)
  if (DEPENDENCY_FILES.has(filename)) {
    return "dependency";
  }

  // Documentation patterns
  for (const pattern of DOC_PATTERNS) {
    if (pattern.test(filename) || pattern.test(normalized)) {
      return "documentation";
    }
  }

  // Configuration
  for (const pattern of CONFIG_PATTERNS) {
    if (pattern.test(filename) || pattern.test(normalized)) {
      return "configuration";
    }
  }

  // Default to source or unknown
  if (ext.length > 1) {
    return "source";
  }

  return "unknown";
}

/**
 * Classifies a GitFileChange object into a ClassifiedFileChange.
 */
export function classifyFileChange(change: GitFileChange): ClassifiedFileChange {
  const category = classifyFilePath(change.path, change.binary);
  return {
    ...change,
    category,
  };
}
