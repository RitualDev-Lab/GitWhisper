import type { GitRemote } from "@gitwhisper/git";
import { parseRemoteDetails, sanitizeRemoteUrl } from "@gitwhisper/git";

export { sanitizeRemoteUrl, parseRemoteDetails };

/**
 * Finds the primary Git remote from available remotes (defaults to 'origin' or first available).
 */
export function findPrimaryRemote(
  remotes: GitRemote[],
  preferredName = "origin",
): GitRemote | undefined {
  if (!remotes || remotes.length === 0) return undefined;
  const match = remotes.find((r) => r.name === preferredName);
  return match ?? remotes[0];
}
