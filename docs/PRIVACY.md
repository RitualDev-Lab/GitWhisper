# GitWhisper Privacy & Data Protection Architecture

GitWhisper is designed around strict privacy boundaries and a local-first philosophy. This document specifies the privacy guarantees, data flows, and security constraints enforced across all operations.

---

## 1. Staged Changes Isolation

GitWhisper operates exclusively on the Git index (`git diff --cached`):

- **Staged files**: Only files explicitly staged by the developer (`git add`) are read.
- **Unstaged modifications**: Changes in the working directory are completely ignored.
- **Untracked files**: Files not tracked by Git (such as local `.env`, `.env.local`, credentials, and scratchpads) are **never** inspected, parsed, or transmitted.
- **Binary files**: Binary assets are never decoded or transmitted; only file paths and change status are noted.

---

## 2. Secret Detection & Pre-Transmission Redaction (Phase 7)

Before any staged patch content or work-item context is transmitted to an external model or API provider:

1. **Multilayer Scanners**:
   - **Known Formats**: High-confidence regex patterns targeting cloud credentials (AWS, GCP, Azure), API keys (OpenAI, Stripe), personal access tokens (GitHub, GitLab, Slack), private keys (RSA, OpenSSH, PGP), and connection strings.
   - **Shannon Entropy Scanners**: High-entropy token detection identifying randomized secrets, bearer tokens, and passwords in assignment contexts.
2. **Deterministic Redaction**:
   - Detected sensitive strings are replaced with deterministic category placeholders (e.g. `<GITWHISPER_REDACTED_AWS_KEY>`).
   - Diff hunk line structures and code context are strictly preserved.
3. **Commit Message Scanning**:
   - The final generated commit message (subject and body) is re-scanned prior to presentation to ensure no model-invented or regurgitated secrets enter the commit history.

---

## 3. Work-Item & Issue Tracker Token Isolation (Phase 8)

When branch intelligence or issue tracker integrations (GitHub Issues, Jira REST) are enabled:

### A. Credential Host-Binding (Release-Blocking Invariant)
User credentials configured for host A (e.g. `jira.company.internal` or `api.github.com`) are strictly bound to that host.
- Repository configuration (`.gitwhisperrc.json`) cannot redirect requests or forward credentials to an unauthorized foreign host.
- Requests to mismatching hosts fail immediately with `SecurityHostBindingError`.

### B. Cross-Domain Redirect Protection
When fetching issue details via HTTP:
- If a response redirects (3xx) to a different origin or domain, the `Authorization` header and all credentials are automatically stripped.
- Redirect loops and SSRF to non-HTTP/HTTPS protocols (`file://`, `ftp://`, `gopher://`) are strictly rejected.

### C. Data Minimization
Issue tracker metadata is untrusted and minimized prior to model consumption:
- **Title**: Sanitized against HTML/terminal escapes and capped at 200 characters.
- **Description / Summary**: Sanitized, stripped of HTML/markdown images, and capped at 500 characters.
- **Excluded Fields**: Author email/username, user comments, timestamps, attachments, and organization metadata are omitted.
- **Secret Redaction**: All issue text undergoes secret detection and redaction before inclusion in AI prompt contexts.

---

## 4. Local vs Remote AI Transmission

GitWhisper explicitly displays provider locality in the CLI:
- **Local (`[Local]`)**: Ollama or local endpoint (`http://localhost:*`, `http://127.0.0.1:*`). All prompt construction and token generation remain entirely on the developer's workstation. Zero network traffic leaves the machine.
- **Remote (`[Remote]`)**: Cloud endpoints (e.g. OpenAI). Staged diffs and issue summaries are transmitted over HTTPS after passing all privacy filters, truncation limits, and secret redaction passes.

---

## 5. Zero Telemetry & Analytics

GitWhisper does not contain any analytics, telemetry, user tracking, or background reporting beacons. All configuration and logs remain exclusively on the user's local disk.
