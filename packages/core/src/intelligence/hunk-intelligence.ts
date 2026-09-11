import path from "node:path";
import type { PatchHunk, FilePatch } from "../patch/types.js";
import type { ChangeSignal } from "./types.js";

export interface HunkIntelligence {
  hunkId: string;
  filePath: string;
  changedSymbols: string[];
  enclosingSymbol?: string;
  importsAffected: string[];
  testRelationship?: string[];
  probableScope?: string;
  signals: ChangeSignal[];
}

/**
 * Extracts the enclosing symbol from the Git hunk header string.
 */
function extractEnclosingSymbol(header?: string): string | undefined {
  if (!header || header.trim().length === 0) return undefined;

  // Patterns for function/class headers
  const funcMatch = header.match(
    /(?:function|def|fn|func|class|interface|type)\s+([a-zA-Z0-9_$]+)/i,
  );
  if (funcMatch) {
    return funcMatch[1];
  }

  // Method pattern: methodName(...)
  const methodMatch = header.match(/([a-zA-Z0-9_$]+)\s*\([^)]*\)/);
  if (methodMatch) {
    return methodMatch[1];
  }

  // Simple identifier
  const identMatch = header.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/);
  if (identMatch) {
    return identMatch[0];
  }

  return undefined;
}

/**
 * Analyzes changed lines in a hunk to extract declared or modified symbols.
 */
function extractChangedSymbols(hunk: PatchHunk): string[] {
  const symbols = new Set<string>();

  const symbolRegexes = [
    /(?:function|def|fn|func)\s+([a-zA-Z0-9_$]+)/g,
    /(?:class|interface|type|struct|enum)\s+([a-zA-Z0-9_$]+)/g,
    /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g,
    /(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*[{:]/g,
  ];

  for (const line of hunk.lines) {
    if (line.kind === "addition" || line.kind === "deletion") {
      for (const rx of symbolRegexes) {
        rx.lastIndex = 0;
        let match = rx.exec(line.content);
        while (match !== null) {
          const sym = match[1];
          // Filter out generic keywords
          if (sym && !["if", "for", "while", "switch", "catch", "return"].includes(sym)) {
            symbols.add(sym);
          }
          match = rx.exec(line.content);
        }
      }
    }
  }

  return Array.from(symbols);
}

/**
 * Extracts affected import modules from changed lines.
 */
function extractImports(hunk: PatchHunk): string[] {
  const imports = new Set<string>();
  const importRegex = /(?:import|require|from)\s+['"]([^'"]+)['"]/g;

  for (const line of hunk.lines) {
    if (line.kind === "addition" || line.kind === "deletion") {
      importRegex.lastIndex = 0;
      let match = importRegex.exec(line.content);
      while (match !== null) {
        if (match[1]) {
          imports.add(match[1]);
        }
        match = importRegex.exec(line.content);
      }
    }
  }

  return Array.from(imports);
}

/**
 * Infers probable scope for a file path.
 */
function inferScopeFromPath(filePath: string): string | undefined {
  const clean = filePath.replace(/\\/g, "/");
  const dir = path.posix.dirname(clean);
  if (dir === "." || !dir) return undefined;

  const parts = dir
    .replace(/^(src|lib|app|packages\/[^/]+\/src|tests|test)\/?/, "")
    .split("/")
    .filter(Boolean);

  if (parts.length > 0) {
    return parts[0];
  }

  const base = path.posix.basename(clean, path.posix.extname(clean));
  if (base && base !== "index" && base !== "main") {
    return base;
  }

  return undefined;
}

/**
 * Enriches a hunk with symbol, import, and scope intelligence.
 */
export function analyzeHunkIntelligence(hunk: PatchHunk, file: FilePatch): HunkIntelligence {
  const filePath = file.newPath || file.oldPath || "unknown";
  const enclosingSymbol = extractEnclosingSymbol(hunk.header);
  const changedSymbols = extractChangedSymbols(hunk);
  const importsAffected = extractImports(hunk);
  const probableScope = inferScopeFromPath(filePath);

  const signals: ChangeSignal[] = [];
  if (enclosingSymbol) {
    signals.push({
      kind: "symbol-enclosing",
      source: "patch",
      evidence: `Hunk is inside symbol '${enclosingSymbol}'`,
      weight: 0.85,
    });
  }
  if (changedSymbols.length > 0) {
    signals.push({
      kind: "symbols-changed",
      source: "patch",
      evidence: `Changed symbols: ${changedSymbols.join(", ")}`,
      weight: 0.8,
    });
  }

  return {
    hunkId: hunk.id,
    filePath,
    changedSymbols,
    enclosingSymbol,
    importsAffected,
    probableScope,
    signals,
  };
}
