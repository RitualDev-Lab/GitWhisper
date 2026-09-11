import { describe, expect, it } from "vitest";
import { parsePatch } from "@gitwhisper/core";

describe("Unified Diff Patch Parser", () => {
  it("parses a standard modified file with multiple hunks", () => {
    const rawDiff = `diff --git a/src/app.ts b/src/app.ts
index e69de29..d95f3ad 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,6 @@
 import { config } from './config';
+import { logger } from './logger';
 
 export function start() {
   return true;
@@ -10,4 +11,5 @@ export function stop() {
   cleanup();
   return false;
+  // stopped
 }
`;

    const patch = parsePatch(rawDiff, "test-fingerprint");
    expect(patch.files).toHaveLength(1);

    const file = patch.files[0];
    expect(file.status).toBe("modified");
    expect(file.oldPath).toBe("src/app.ts");
    expect(file.newPath).toBe("src/app.ts");
    expect(file.hunks).toHaveLength(2);

    expect(file.hunks[0].id).toBe("f1:h1");
    expect(file.hunks[0].oldStart).toBe(1);
    expect(file.hunks[0].oldCount).toBe(5);
    expect(file.hunks[0].newStart).toBe(1);
    expect(file.hunks[0].newCount).toBe(6);
    expect(file.hunks[0].fingerprint).toMatch(/^[0-9a-f]{40}$/);

    expect(file.hunks[1].id).toBe("f1:h2");
    expect(file.hunks[1].oldStart).toBe(10);
    expect(file.hunks[1].header).toBe("export function stop() {");
  });

  it("parses added files (new file mode and /dev/null)", () => {
    const rawDiff = `diff --git a/src/new-module.ts b/src/new-module.ts
new file mode 100644
index 0000000..7c2d921
--- /dev/null
+++ b/src/new-module.ts
@@ -0,0 +1,3 @@
+export function newFunc() {
+  return 42;
+}
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    const file = patch.files[0];
    expect(file.status).toBe("added");
    expect(file.newMode).toBe("100644");
    expect(file.newPath).toBe("src/new-module.ts");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].lines).toHaveLength(3);
    expect(file.hunks[0].lines.every((l) => l.kind === "addition")).toBe(true);
  });

  it("parses deleted files", () => {
    const rawDiff = `diff --git a/src/obsolete.ts b/src/obsolete.ts
deleted file mode 100644
index 7c2d921..0000000
--- a/src/obsolete.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const old = 1;
-export default old;
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    const file = patch.files[0];
    expect(file.status).toBe("deleted");
    expect(file.oldPath).toBe("src/obsolete.ts");
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].lines.every((l) => l.kind === "deletion")).toBe(true);
  });

  it("parses file renames with modifications", () => {
    const rawDiff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 80%
rename from src/old-name.ts
rename to src/new-name.ts
index e69de29..d95f3ad 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
-export const v = 1;
+export const v = 2;
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    const file = patch.files[0];
    expect(file.status).toBe("renamed");
    expect(file.oldPath).toBe("src/old-name.ts");
    expect(file.newPath).toBe("src/new-name.ts");
    expect(file.hunks).toHaveLength(1);
  });

  it("parses mode changes", () => {
    const rawDiff = `diff --git a/scripts/run.sh b/scripts/run.sh
old mode 100644
new mode 100755
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    const file = patch.files[0];
    expect(file.oldMode).toBe("100644");
    expect(file.newMode).toBe("100755");
    expect(file.hunks).toHaveLength(0);
  });

  it("parses binary files", () => {
    const rawDiff = `diff --git a/logo.png b/logo.png
index e69de29..d95f3ad 100644
Binary files a/logo.png and b/logo.png differ
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    const file = patch.files[0];
    expect(file.binary).toBe(true);
  });

  it("handles filenames with spaces and quotes", () => {
    const rawDiff = `diff --git "a/path with spaces/file name.ts" "b/path with spaces/file name.ts"
index e69de29..d95f3ad 100644
--- "a/path with spaces/file name.ts"
+++ "b/path with spaces/file name.ts"
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    expect(patch.files[0].newPath).toBe("path with spaces/file name.ts");
  });

  it("handles Unicode identifiers and content", () => {
    const rawDiff = `diff --git a/src/i18n.ts b/src/i18n.ts
index e69de29..d95f3ad 100644
--- a/src/i18n.ts
+++ b/src/i18n.ts
@@ -1,2 +1,2 @@
-export const greeting = "Hello";
+export const greeting = "こんにちは 🌍";
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    expect(patch.files[0].hunks[0].lines[1].content).toBe(
      'export const greeting = "こんにちは 🌍";',
    );
  });

  it("handles \\ No newline at end of file marker", () => {
    const rawDiff = `diff --git a/file.txt b/file.txt
index e69de29..d95f3ad 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-line without newline
\\ No newline at end of file
+line with newline
`;

    const patch = parsePatch(rawDiff);
    expect(patch.files).toHaveLength(1);
    const lines = patch.files[0].hunks[0].lines;
    expect(lines.some((l) => l.kind === "metadata")).toBe(true);
  });
});
