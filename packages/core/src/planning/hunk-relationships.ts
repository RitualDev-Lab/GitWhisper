import path from "node:path";
import type { HunkIntelligence } from "../intelligence/hunk-intelligence.js";
import type { PatchHunk, FilePatch } from "../patch/types.js";

export type HunkRelationshipKind =
  | "same-symbol"
  | "same-function"
  | "same-class"
  | "source-test"
  | "same-import"
  | "same-module"
  | "adjacent"
  | "dependency";

export interface HunkRelationship {
  sourceHunkId: string;
  targetHunkId: string;
  type: HunkRelationshipKind;
  confidence: number;
  reason: string;
}

/**
 * Checks if two hunks share a symbol or function.
 */
function checkSymbolCoupling(a: HunkIntelligence, b: HunkIntelligence): HunkRelationship | null {
  if (a.filePath !== b.filePath) return null;

  // Exact same enclosing symbol
  if (a.enclosingSymbol && b.enclosingSymbol && a.enclosingSymbol === b.enclosingSymbol) {
    return {
      sourceHunkId: a.hunkId,
      targetHunkId: b.hunkId,
      type: "same-function",
      confidence: 0.9,
      reason: `Both hunks modify function '${a.enclosingSymbol}'`,
    };
  }

  // Shared changed symbols
  const sharedSymbols = a.changedSymbols.filter((s) => b.changedSymbols.includes(s));
  if (sharedSymbols.length > 0) {
    return {
      sourceHunkId: a.hunkId,
      targetHunkId: b.hunkId,
      type: "same-symbol",
      confidence: 0.88,
      reason: `Both hunks touch symbol(s): ${sharedSymbols.join(", ")}`,
    };
  }

  return null;
}

/**
 * Checks if one hunk is in a test file and covers the other hunk.
 */
function checkSourceTestCoupling(
  intelA: HunkIntelligence,
  intelB: HunkIntelligence,
): HunkRelationship | null {
  const isTestA = intelA.filePath.includes("test") || intelA.filePath.includes("spec");
  const isTestB = intelB.filePath.includes("test") || intelB.filePath.includes("spec");

  if (isTestA === isTestB) return null;

  const testIntel = isTestA ? intelA : intelB;
  const srcIntel = isTestA ? intelB : intelA;

  const srcStem = path.posix
    .basename(srcIntel.filePath)
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .toLowerCase();

  const testBase = path.posix.basename(testIntel.filePath).toLowerCase();

  // Test matches source file stem
  if (testBase.includes(srcStem)) {
    // If test hunk touches a symbol declared/modified in source hunk, super strong
    const sharedSymbol = srcIntel.changedSymbols.some((s) => testIntel.changedSymbols.includes(s));
    return {
      sourceHunkId: srcIntel.hunkId,
      targetHunkId: testIntel.hunkId,
      type: "source-test",
      confidence: sharedSymbol ? 0.95 : 0.88,
      reason: `Test hunk ${testIntel.hunkId} tests source hunk ${srcIntel.hunkId}`,
    };
  }

  return null;
}

/**
 * Checks if hunk A imports a file or module modified by hunk B.
 */
function checkImportCoupling(a: HunkIntelligence, b: HunkIntelligence): HunkRelationship | null {
  const baseB = path.posix.basename(b.filePath).replace(/\.[a-zA-Z0-9]+$/, "");
  const baseA = path.posix.basename(a.filePath).replace(/\.[a-zA-Z0-9]+$/, "");

  if (baseB.length >= 3 && a.importsAffected.some((imp) => imp.includes(baseB))) {
    return {
      sourceHunkId: a.hunkId,
      targetHunkId: b.hunkId,
      type: "same-import",
      confidence: 0.78,
      reason: `Hunk ${a.hunkId} imports module from ${b.filePath}`,
    };
  }

  if (baseA.length >= 3 && b.importsAffected.some((imp) => imp.includes(baseA))) {
    return {
      sourceHunkId: b.hunkId,
      targetHunkId: a.hunkId,
      type: "same-import",
      confidence: 0.78,
      reason: `Hunk ${b.hunkId} imports module from ${a.filePath}`,
    };
  }

  return null;
}

/**
 * Checks if two hunks in the same file are physically adjacent.
 */
function checkAdjacency(
  hunkA: PatchHunk,
  hunkB: PatchHunk,
  filePathA: string,
  filePathB: string,
): HunkRelationship | null {
  if (filePathA !== filePathB) return null;

  const gap = Math.abs(hunkB.newStart - (hunkA.newStart + hunkA.newCount));
  if (gap <= 5) {
    return {
      sourceHunkId: hunkA.id,
      targetHunkId: hunkB.id,
      type: "adjacent",
      confidence: 0.55,
      reason: `Hunks are within ${gap} lines in ${filePathA}`,
    };
  }

  return null;
}

/**
 * Discovers pairwise relationships across all staged hunks.
 */
export function discoverHunkRelationships(
  hunksWithIntel: Array<{ hunk: PatchHunk; intel: HunkIntelligence; file: FilePatch }>,
): HunkRelationship[] {
  const relationships: HunkRelationship[] = [];

  for (let i = 0; i < hunksWithIntel.length; i++) {
    for (let j = i + 1; j < hunksWithIntel.length; j++) {
      const a = hunksWithIntel[i];
      const b = hunksWithIntel[j];

      // 1. Symbol / function coupling
      const symRel = checkSymbolCoupling(a.intel, b.intel);
      if (symRel) {
        relationships.push(symRel);
        continue;
      }

      // 2. Source <-> Test coupling
      const stRel = checkSourceTestCoupling(a.intel, b.intel);
      if (stRel) {
        relationships.push(stRel);
        continue;
      }

      // 3. Import coupling
      const impRel = checkImportCoupling(a.intel, b.intel);
      if (impRel) {
        relationships.push(impRel);
        continue;
      }

      // 4. Adjacency in same file
      const adjRel = checkAdjacency(
        a.hunk,
        b.hunk,
        a.file.newPath || a.file.oldPath || "",
        b.file.newPath || b.file.oldPath || "",
      );
      if (adjRel) {
        relationships.push(adjRel);
        continue;
      }

      // 5. Same module prefix
      if (
        a.intel.probableScope &&
        b.intel.probableScope &&
        a.intel.probableScope === b.intel.probableScope
      ) {
        relationships.push({
          sourceHunkId: a.hunk.id,
          targetHunkId: b.hunk.id,
          type: "same-module",
          confidence: 0.65,
          reason: `Both hunks belong to scope '${a.intel.probableScope}'`,
        });
      }
    }
  }

  return relationships;
}
