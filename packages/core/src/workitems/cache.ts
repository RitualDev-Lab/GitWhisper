import type { CachedWorkItem, WorkItem } from "./types.js";

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class WorkItemCache {
  private cache = new Map<string, CachedWorkItem>();

  public buildKey(provider: string, host: string, projectOrRepo: string, key: string): string {
    return `${provider.toLowerCase()}:${host.toLowerCase()}:${projectOrRepo.toLowerCase()}:${key.toUpperCase()}`;
  }

  public get(cacheKey: string): WorkItem | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return entry.workItem;
  }

  public set(cacheKey: string, workItem: WorkItem, ttlMs: number = DEFAULT_TTL_MS): void {
    const now = Date.now();
    this.cache.set(cacheKey, {
      workItem,
      fetchedAt: now,
      expiresAt: now + ttlMs,
    });
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

export const globalWorkItemCache = new WorkItemCache();
