import type { MyIDEAdapter } from "./adapter.js";
import type { IDEActionResult } from "./types.js";

export interface VSCodeQuickPickVariant {
  label: string;
  description: string;
  detail?: string;
  variantId: string;
}

/**
 * Transforms generated variants into standard VS Code QuickPick items.
 */
export function formatVariantsForQuickPick(
  variants: Array<{ id: string; subject: string; body?: string; description?: string }>,
): VSCodeQuickPickVariant[] {
  return variants.map((v) => ({
    label: v.subject,
    description: `(${v.id})`,
    detail: v.body ? v.body.replace(/\n/g, " ") : (v.description ?? v.subject),
    variantId: v.id,
  }));
}

/**
 * Command bridge helper that registers standard GitWhisper IDE actions.
 */
export function createVSCodeCommandBridge(adapter: MyIDEAdapter) {
  return {
    "gitwhisper.generate": () => adapter.generateCommitMessage(),
    "gitwhisper.variants": () => adapter.generateVariants(),
    "gitwhisper.explain": () => adapter.explainCommit(),
    "gitwhisper.check": (message: string) => adapter.checkMessage(message),
    "gitwhisper.detectConcerns": () => adapter.detectMultipleConcerns(),
    "gitwhisper.plan": () => adapter.createCommitPlan(),
    "gitwhisper.previewPatch": (groupId?: string) => adapter.previewCommitPatch(groupId),
    "gitwhisper.commitApproved": (messageOrPlan: any, confirmed: boolean) =>
      adapter.executeApprovedCommit(messageOrPlan, { confirmed }),
  };
}
