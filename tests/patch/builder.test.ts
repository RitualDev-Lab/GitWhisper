import { describe, expect, it } from "vitest";
import { parsePatch, buildPatchSelection, buildRemainingPatch } from "@gitwhisper/core";

describe("Patch Reconstruction & Selection Builder", () => {
  const multiFileDiff = `diff --git a/src/auth.ts b/src/auth.ts
index e69de29..d95f3ad 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,5 +1,6 @@
 import { token } from './token';
+import { session } from './session';
 
 export function auth() {
   return true;
@@ -20,4 +21,5 @@ export function logout() {
   clear();
   return true;
+  // logout
 }
diff --git a/src/ui.ts b/src/ui.ts
index 1111111..2222222 100644
--- a/src/ui.ts
+++ b/src/ui.ts
@@ -1,3 +1,4 @@
 export function render() {
+  console.log('rendering');
   return null;
 }
`;

  it("builds a unified diff containing only the selected hunk from file 1", () => {
    const patch = parsePatch(multiFileDiff);
    const selected = buildPatchSelection(patch, ["f1:h1"]);

    expect(selected).toContain("diff --git a/src/auth.ts b/src/auth.ts");
    expect(selected).toContain("+import { session } from './session';");
    expect(selected).not.toContain("// logout");
    expect(selected).not.toContain("diff --git a/src/ui.ts b/src/ui.ts");
  });

  it("builds a unified diff with selected hunks across multiple files", () => {
    const patch = parsePatch(multiFileDiff);
    const selected = buildPatchSelection(patch, ["f1:h2", "f2:h1"]);

    expect(selected).toContain("diff --git a/src/auth.ts b/src/auth.ts");
    expect(selected).toContain("// logout");
    expect(selected).not.toContain("import { session } from './session';");

    expect(selected).toContain("diff --git a/src/ui.ts b/src/ui.ts");
    expect(selected).toContain("+  console.log('rendering');");
  });

  it("builds the remaining patch excluding committed hunks", () => {
    const patch = parsePatch(multiFileDiff);
    const remaining = buildRemainingPatch(patch, ["f1:h1"]);

    expect(remaining).toContain("// logout");
    expect(remaining).toContain("rendering");
    expect(remaining).not.toContain("import { session } from './session';");
  });
});
