import type {
  WorkItem,
  WorkItemProvider,
  WorkItemProviderValidation,
  WorkItemReference,
  WorkItemResolution,
} from "../types.js";

export class GenericWorkItemProvider implements WorkItemProvider {
  public readonly id = "generic" as const;

  public async validateConfiguration(): Promise<WorkItemProviderValidation> {
    return { valid: true };
  }

  public async resolve(
    reference: WorkItemReference,
    _signal?: AbortSignal,
  ): Promise<WorkItemResolution> {
    const workItem: WorkItem = {
      provider: "generic",
      key: reference.key,
    };
    return {
      found: true,
      workItem,
    };
  }
}
