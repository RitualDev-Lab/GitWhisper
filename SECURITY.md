# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.8.x   | :white_check_mark: |
| 0.7.x   | :white_check_mark: |
| 0.6.x   | :white_check_mark: |
| 0.5.x   | :white_check_mark: |
| 0.4.x   | :white_check_mark: |
| 0.3.x   | :white_check_mark: |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :white_check_mark: |

---

## Security Architecture & Invariants

GitWhisper enforces defense-in-depth guarantees across local Git interactions, external trackers, and AI providers:

1. **Credential Host-Binding (Release-Blocking Invariant)**:
   - Developer tokens and credentials for external work-item trackers (e.g. GitHub, Jira) are strictly bound to their canonical hosts.
   - Malicious or compromised repository configuration files cannot redirect credential transmission to foreign hosts.
2. **Redirect & SSRF Protection**:
   - Outbound HTTP requests strip `Authorization` headers on cross-origin redirects.
   - Non-HTTP/HTTPS schemes (`file://`, `ftp://`, `gopher://`, etc.) are rejected immediately.
3. **Data Isolation & Staged Boundaries**:
   - Only explicitly staged files (`git diff --cached`) are read.
   - Working tree modifications, `.env` files, and untracked files are never read, mutated, or sent.
4. **Secret Scanning & Redaction**:
   - Multi-layered regex and Shannon entropy scanners identify sensitive tokens prior to AI transmission and replace them with placeholders.
   - Commit messages are scanned post-generation to prevent secret regurgitation.
5. **Prompt Injection & Terminal Sanitization**:
   - Code diffs and issue payloads are treated strictly as inert data in system prompts.
   - Terminal control characters, ANSI escapes, and OSC window title strings are sanitized from all branch names, issues, and commit messages.

---

## Reporting a Vulnerability

If you discover a potential security vulnerability in GitWhisper, please report it responsibly:

- **Email**: security@ritualdev.com
- Do NOT create a public issue on GitHub for security vulnerabilities.

Please include:
1. Description of the issue
2. Steps to reproduce
3. Potential impact

We will review reports promptly and publish patches in accordance with responsible disclosure practices.

