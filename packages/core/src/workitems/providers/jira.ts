import { normalizeHost, safeFetch } from "../security.js";
import type {
  WorkItem,
  WorkItemProvider,
  WorkItemProviderValidation,
  WorkItemReference,
  WorkItemResolution,
} from "../types.js";

export interface JiraProviderOptions {
  baseUrl?: string;
  token?: string;
  email?: string;
  project?: string;
}

export class JiraWorkItemProvider implements WorkItemProvider {
  public readonly id = "jira" as const;
  private baseUrl?: string;
  private token?: string;
  private email?: string;
  private project?: string;

  constructor(options: JiraProviderOptions = {}) {
    this.baseUrl = options.baseUrl ? options.baseUrl.replace(/\/$/, "") : undefined;
    this.token = options.token || process.env.GITWHISPER_JIRA_TOKEN || process.env.JIRA_TOKEN;
    this.email = options.email || process.env.GITWHISPER_JIRA_EMAIL;
    this.project = options.project;
  }

  public async validateConfiguration(): Promise<WorkItemProviderValidation> {
    if (!this.baseUrl) {
      return {
        valid: false,
        error: "Jira base URL is not configured. Specify baseUrl in gitwhisper configuration.",
      };
    }
    return { valid: true };
  }

  public async resolve(
    reference: WorkItemReference,
    signal?: AbortSignal,
  ): Promise<WorkItemResolution> {
    const key = reference.key.toUpperCase();
    const validation = await this.validateConfiguration();
    if (!validation.valid) {
      return { found: false, error: validation.error };
    }

    const targetUrl = `${this.baseUrl}/rest/api/2/issue/${key}?fields=summary,description,status,labels,project`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "GitWhisper/0.8.0",
    };

    if (this.token) {
      if (this.email) {
        const credentials = Buffer.from(`${this.email}:${this.token}`).toString("base64");
        headers.Authorization = `Basic ${credentials}`;
      } else {
        headers.Authorization = `Bearer ${this.token}`;
      }
    }

    try {
      const allowedHost = normalizeHost(this.baseUrl!);
      const res = await safeFetch(targetUrl, {
        method: "GET",
        headers,
        signal,
        allowedHost,
        hasCredentials: Boolean(this.token),
      });

      if (res.status === 404) {
        return {
          found: false,
          error: `Jira issue ${key} not found at ${this.baseUrl}.`,
        };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          found: false,
          error: `Jira authentication failed for ${key}.`,
        };
      }

      if (!res.ok) {
        return {
          found: false,
          error: `Jira API error: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const data = (await res.json()) as {
        key: string;
        fields?: {
          summary?: string;
          description?: unknown;
          status?: { name?: string };
          labels?: string[];
          project?: { key?: string; name?: string };
        };
      };

      let descriptionText: string | undefined;
      if (typeof data.fields?.description === "string") {
        descriptionText = data.fields.description;
      }

      const workItem: WorkItem = {
        provider: "jira",
        key: data.key || key,
        title: data.fields?.summary,
        description: descriptionText,
        state: data.fields?.status?.name,
        url: `${this.baseUrl}/browse/${key}`,
        labels: data.fields?.labels || [],
        project: data.fields?.project?.key || this.project,
        fetchedAt: new Date().toISOString(),
      };

      return {
        found: true,
        workItem,
      };
    } catch (err: unknown) {
      return {
        found: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
