import path from "node:path";
import type { ClassifiedFileChange } from "../types.js";
import type { ChangeRelationship, RelationshipType } from "./types.js";

interface KnownManifestLockfile {
  manifests: string[];
  lockfiles: string[];
}

const MANIFEST_LOCK_PAIRS: KnownManifestLockfile[] = [
  {
    manifests: ["package.json"],
    lockfiles: ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"],
  },
  {
    manifests: ["Cargo.toml"],
    lockfiles: ["Cargo.lock"],
  },
  {
    manifests: ["pyproject.toml", "Pipfile", "requirements.txt"],
    lockfiles: ["poetry.lock", "Pipfile.lock", "requirements.lock", "pdm.lock"],
  },
  {
    manifests: ["go.mod"],
    lockfiles: ["go.sum"],
  },
  {
    manifests: ["composer.json"],
    lockfiles: ["composer.lock"],
  },
  {
    manifests: ["Gemfile"],
    lockfiles: ["Gemfile.lock"],
  },
];

/**
 * Normalizes a file path to forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Extracts normalized stem for source <-> test matching.
 */
function getStem(filePath: string): string {
  const norm = normalizePath(filePath);
  const base = path.posix.basename(norm);
  // remove test suffixes
  const stripped = base
    .replace(/\.(test|spec)\.[a-zA-Z0-9]+$/, "")
    .replace(/(_test|test_)\.[a-zA-Z0-9]+$/, "")
    .replace(/\.[a-zA-Z0-9]+$/, "");
  return stripped.toLowerCase();
}

/**
 * Extracts directory parts excluding common roots like src, lib, test, tests.
 */
function getCoreDir(filePath: string): string {
  const norm = normalizePath(filePath);
  const dir = path.posix.dirname(norm);
  return dir
    .replace(/^(src|lib|app|packages\/[^/]+\/src|tests|test|__tests__)\/?/, "")
    .replace(/\/?(__tests__)$/, "")
    .toLowerCase();
}

/**
 * Checks if two files have a manifest <-> lockfile relationship.
 */
function checkManifestLockfile(fileA: string, fileB: string): ChangeRelationship | null {
  const dirA = path.posix.dirname(normalizePath(fileA));
  const dirB = path.posix.dirname(normalizePath(fileB));

  if (dirA !== dirB) {
    return null;
  }

  const baseA = path.posix.basename(normalizePath(fileA));
  const baseB = path.posix.basename(normalizePath(fileB));

  for (const pair of MANIFEST_LOCK_PAIRS) {
    const isAManifest = pair.manifests.includes(baseA);
    const isBLock = pair.lockfiles.includes(baseB);
    const isBManifest = pair.manifests.includes(baseB);
    const isALock = pair.lockfiles.includes(baseA);

    if ((isAManifest && isBLock) || (isBManifest && isALock)) {
      return {
        source: fileA,
        target: fileB,
        type: "manifest-lockfile",
        confidence: 0.99,
        reason: `Package manifest and lockfile pair in ${dirA || "root"}`,
      };
    }
  }

  return null;
}

/**
 * Checks if one file is a test for the other.
 */
function checkSourceTest(
  changeA: ClassifiedFileChange,
  changeB: ClassifiedFileChange,
): ChangeRelationship | null {
  const isATest = changeA.category === "test";
  const isBTest = changeB.category === "test";

  if (isATest === isBTest) {
    return null; // Both test or neither test
  }

  const testFile = isATest ? changeA.path : changeB.path;
  const srcFile = isATest ? changeB.path : changeA.path;

  const stemTest = getStem(testFile);
  const stemSrc = getStem(srcFile);

  if (!stemTest || !stemSrc) {
    return null;
  }

  if (stemTest === stemSrc) {
    const coreDirTest = getCoreDir(testFile);
    const coreDirSrc = getCoreDir(srcFile);

    // If core directory matches or one is empty/subpath
    if (
      coreDirTest === coreDirSrc ||
      coreDirTest.endsWith(coreDirSrc) ||
      coreDirSrc.endsWith(coreDirTest)
    ) {
      return {
        source: srcFile,
        target: testFile,
        type: "source-test",
        confidence: 0.95,
        reason: `Test ${testFile} directly tests ${srcFile}`,
      };
    }

    // Matching stems even across slightly different test dirs
    return {
      source: srcFile,
      target: testFile,
      type: "source-test",
      confidence: 0.85,
      reason: `Test ${testFile} matches name of ${srcFile}`,
    };
  }

  return null;
}

/**
 * Checks if a doc file is related to a source file or component.
 */
function checkDocSource(
  changeA: ClassifiedFileChange,
  changeB: ClassifiedFileChange,
): ChangeRelationship | null {
  const isADoc = changeA.category === "documentation";
  const isBDoc = changeB.category === "documentation";

  if (isADoc === isBDoc) {
    return null;
  }

  const docFile = isADoc ? changeA.path : changeB.path;
  const srcFile = isADoc ? changeB.path : changeA.path;

  const docStem = getStem(docFile);
  const srcStem = getStem(srcFile);
  const srcDir = getCoreDir(srcFile);

  if (docStem && (docStem === srcStem || srcDir.includes(docStem))) {
    return {
      source: srcFile,
      target: docFile,
      type: "doc-source",
      confidence: 0.75,
      reason: `Documentation ${docFile} documents component ${docStem}`,
    };
  }

  return null;
}

/**
 * Checks for direct import statements in patch content.
 */
function checkImports(fileA: string, fileB: string, patch?: string): ChangeRelationship | null {
  if (!patch) return null;

  const baseA = path.posix.basename(fileA).replace(/\.[a-zA-Z0-9]+$/, "");
  const baseB = path.posix.basename(fileB).replace(/\.[a-zA-Z0-9]+$/, "");

  if (baseA.length < 3 || baseB.length < 3) return null;

  // Search if patch shows an import of baseB in fileA or vice versa
  const importRegexB = new RegExp(
    `(?:import|require|from)\\s+['"][^'"]*\\/${baseB}(?:\\.[a-zA-Z0-9]+)?['"]`,
  );
  const importRegexA = new RegExp(
    `(?:import|require|from)\\s+['"][^'"]*\\/${baseA}(?:\\.[a-zA-Z0-9]+)?['"]`,
  );

  if (importRegexB.test(patch) || importRegexA.test(patch)) {
    return {
      source: fileA,
      target: fileB,
      type: "import-dependency",
      confidence: 0.85,
      reason: `Direct import relationship detected between ${fileA} and ${fileB}`,
    };
  }

  return null;
}

/**
 * Checks common directory / module prefix.
 */
function checkDirectoryPrefix(fileA: string, fileB: string): ChangeRelationship | null {
  const normA = normalizePath(fileA);
  const normB = normalizePath(fileB);

  const dirA = path.posix.dirname(normA);
  const dirB = path.posix.dirname(normB);

  if (dirA === "." || dirB === ".") {
    return null;
  }

  // Identical directory
  if (dirA === dirB) {
    const depth = dirA.split("/").length;
    // deeper directories have higher cohesion
    const conf = depth >= 2 ? 0.72 : 0.65;
    return {
      source: fileA,
      target: fileB,
      type: "directory-prefix",
      confidence: conf,
      reason: `Files share directory ${dirA}`,
    };
  }

  // Nested directory or common module parent
  const partsA = dirA.split("/");
  const partsB = dirB.split("/");
  let commonDepth = 0;
  while (
    commonDepth < partsA.length &&
    commonDepth < partsB.length &&
    partsA[commonDepth] === partsB[commonDepth]
  ) {
    commonDepth++;
  }

  // Must share at least 2 segments (e.g. src/auth) or a specific non-generic root
  const commonPrefix = partsA.slice(0, commonDepth).join("/");
  const genericRoots = ["src", "lib", "app", "packages"];
  if (commonDepth >= 2 && !genericRoots.includes(commonPrefix)) {
    return {
      source: fileA,
      target: fileB,
      type: "directory-prefix",
      confidence: 0.62,
      reason: `Files share module directory prefix ${commonPrefix}`,
    };
  }

  return null;
}

/**
 * Discovers relationships among changed files.
 */
export function discoverRelationships(
  files: ClassifiedFileChange[],
  patch?: string,
): ChangeRelationship[] {
  const relationships: ChangeRelationship[] = [];

  // 1. Rename relationships
  for (const file of files) {
    if (file.status === "renamed" && file.previousPath) {
      relationships.push({
        source: file.previousPath,
        target: file.path,
        type: "rename",
        confidence: 0.98,
        reason: `File renamed from ${file.previousPath} to ${file.path}`,
      });
    }
  }

  // 2. Pairwise checks
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i];
      const b = files[j];

      // Manifest <-> Lockfile
      const ml = checkManifestLockfile(a.path, b.path);
      if (ml) {
        relationships.push(ml);
        continue;
      }

      // Source <-> Test
      const st = checkSourceTest(a, b);
      if (st) {
        relationships.push(st);
        continue;
      }

      // Doc <-> Source
      const ds = checkDocSource(a, b);
      if (ds) {
        relationships.push(ds);
      }

      // Import dependency
      const imp = checkImports(a.path, b.path, patch);
      if (imp) {
        relationships.push(imp);
      }

      // Directory prefix
      const dp = checkDirectoryPrefix(a.path, b.path);
      if (dp) {
        // If we don't already have an import or doc relationship for this pair, add it
        const alreadyHasPair = relationships.some(
          (r) =>
            (r.source === a.path && r.target === b.path) ||
            (r.source === b.path && r.target === a.path),
        );
        if (!alreadyHasPair) {
          relationships.push(dp);
        }
      }
    }
  }

  return relationships;
}
