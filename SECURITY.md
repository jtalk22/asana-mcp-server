# Security Policy

## What this server touches

An Asana **Personal Access Token** carries the same access as your Asana login — every
workspace, project, and task your account can see or change. Treat it like a password.

## How the token is handled

- Read from `ASANA_PAT`, the macOS Keychain (service `asana-mcp`), or `~/.asana-mcp.json`
  (written by `--setup` with mode `600`), in that order.
- Sent to exactly one place: `https://app.asana.com/api/1.0` over TLS.
- Never logged, never written into tool output, never sent to any third party. There is no
  telemetry and no phone-home of any kind — read the source, it's small.

## Guardrails in the tool surface

- The three irreversible tools (`asana_delete_task`, `asana_delete_project`,
  `asana_delete_section`) are no-ops without `confirm: true` and carry the MCP
  `destructiveHint` annotation so clients can gate them.
- `asana_batch_ops` accepts GET actions only in both its schema and runtime
  validation. Write or delete methods are rejected before any request is sent.
- `asana_attach_file` is a no-op without `confirm: true`. Confirmed paths must
  resolve inside the current working directory or a path listed in
  `ASANA_MCP_FILE_ROOTS` (use the platform path delimiter for multiple roots).
  Symlink targets are checked after resolution and files over 100MB are rejected.
- Every tool declares `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations —
  clients that honor annotations can auto-allow reads and require approval for writes.
- `ASANA_MCP_TOOLS=read` mounts a read-only surface: the write tools are not advertised
  and calls to them are rejected.

## Reporting a vulnerability

Open a GitHub issue for non-sensitive reports. For anything sensitive, use GitHub's
private vulnerability reporting on this repository. Reports get a response within 72 hours.

## Scope notes

- This is a local stdio process; it has no network listener.
- Revoke a token at any time at https://app.asana.com/0/my-apps — revocation is immediate.
