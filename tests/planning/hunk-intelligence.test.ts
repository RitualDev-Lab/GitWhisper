import { describe, expect, it } from "vitest";
import { analyzeHunkIntelligence, discoverHunkRelationships, parsePatch } from "@gitwhisper/core";

describe("Hunk Intelligence & Symbol Extraction", () => {
  it("extracts function and class symbols from hunk headers and line content", () => {
    const rawDiff = `diff --git a/src/auth.ts b/src/auth.ts
index e69de29..d95f3ad 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,12 @@ export class AuthService {
+  public async validateSession(token: string): Promise<boolean> {
+    const decoded = verifyToken(token);
+    return decoded !== null;
+  }
`;

    const patch = parsePatch(rawDiff);
    const file = patch.files[0];
    const hunk = file.hunks[0];
    const intel = analyzeHunkIntelligence(hunk, file);

    expect(intel.filePath).toBe("src/auth.ts");
    expect(intel.probableScope).toBe("auth");
    expect(intel.enclosingSymbol).toBe("AuthService");
    expect(intel.changedSymbols).toContain("validateSession");
  });

  it("extracts imported modules from hunk addition lines", () => {
    const rawDiff = `diff --git a/src/client.ts b/src/client.ts
index e69de29..d95f3ad 100644
--- a/src/client.ts
+++ b/src/client.ts
@@ -1,3 +1,5 @@
+import { HttpClient } from "./http";
+import axios from "axios";
 const existing = true;
`;

    const patch = parsePatch(rawDiff);
    const file = patch.files[0];
    const hunk = file.hunks[0];
    const intel = analyzeHunkIntelligence(hunk, file);

    expect(intel.importsAffected).toContain("./http");
    expect(intel.importsAffected).toContain("axios");
  });

  it("discovers same-function relationships across hunks", () => {
    const rawDiff = `diff --git a/src/user.ts b/src/user.ts
index e69de29..d95f3ad 100644
--- a/src/user.ts
+++ b/src/user.ts
@@ -10,6 +10,8 @@ export function updateUser(id: string) {
+  validateUserId(id);
+  logUpdate(id);
@@ -50,6 +52,8 @@ export function updateUser(id: string) {
+  notifySubscribers(id);
+  return true;
`;

    const patch = parsePatch(rawDiff);
    const file = patch.files[0];
    const hunks = file.hunks;
    expect(hunks).toHaveLength(2);

    const intel0 = analyzeHunkIntelligence(hunks[0], file);
    const intel1 = analyzeHunkIntelligence(hunks[1], file);

    const rels = discoverHunkRelationships([
      { hunk: hunks[0], intel: intel0, file },
      { hunk: hunks[1], intel: intel1, file },
    ]);

    const pairRel = rels.find(
      (r) =>
        (r.sourceHunkId === hunks[0].id && r.targetHunkId === hunks[1].id) ||
        (r.sourceHunkId === hunks[1].id && r.targetHunkId === hunks[0].id),
    );

    expect(pairRel).toBeDefined();
    expect(pairRel?.type).toBe("same-function");
  });

  it("discovers source-test relationships across hunks in source and test files", () => {
    const rawDiff = `diff --git a/src/parser.ts b/src/parser.ts
index e69de29..d95f3ad 100644
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -1,5 +1,7 @@
+export function parseToken(input: string): string {
+  return input.trim();
+}
diff --git a/tests/parser.test.ts b/tests/parser.test.ts
new file mode 100644
index 0000000..7c2d921
--- /dev/null
+++ b/tests/parser.test.ts
@@ -0,0 +1,5 @@
+import { parseToken } from "../src/parser";
+test("parseToken", () => {
+  expect(parseToken(" a ")).toBe("a");
+});
`;

    const patch = parsePatch(rawDiff);
    const file0 = patch.files[0];
    const file1 = patch.files[1];
    const hunk0 = file0.hunks[0];
    const hunk1 = file1.hunks[0];

    const intel0 = analyzeHunkIntelligence(hunk0, file0);
    const intel1 = analyzeHunkIntelligence(hunk1, file1);

    const rels = discoverHunkRelationships([
      { hunk: hunk0, intel: intel0, file: file0 },
      { hunk: hunk1, intel: intel1, file: file1 },
    ]);

    const pairRel = rels.find(
      (r) =>
        (r.sourceHunkId === hunk0.id && r.targetHunkId === hunk1.id) ||
        (r.sourceHunkId === hunk1.id && r.targetHunkId === hunk0.id),
    );

    expect(pairRel).toBeDefined();
    expect(pairRel?.type).toBe("source-test");
  });
});
