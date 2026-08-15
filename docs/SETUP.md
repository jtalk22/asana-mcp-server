# Setup

## 1. Token

Create a Personal Access Token: https://app.asana.com/0/my-apps → **Personal access
tokens** → *Create new token*. Then either

```bash
npx -y @jtalk22/asana-mcp --setup
```

(macOS: stored in the Keychain under `asana-mcp`; elsewhere: `~/.asana-mcp.json`, mode 600)
— or export `ASANA_PAT` in the environment your MCP client passes to servers.

## 2. Client config

**Claude Code**

```bash
claude mcp add asana -- npx -y @jtalk22/asana-mcp
```

**Claude Desktop / Cursor / Windsurf / any stdio client** — add to the client's MCP config:

```json
{
  "mcpServers": {
    "asana": {
      "command": "npx",
      "args": ["-y", "@jtalk22/asana-mcp"],
      "env": { "ASANA_PAT": "1/1234…" }
    }
  }
}
```

The `env` block is optional when the token is in the Keychain/file.

## 3. Verify

```bash
npx -y @jtalk22/asana-mcp --doctor
```

Green means: token found → Asana accepts it → workspace resolved → tool surface loaded.

## Multi-workspace tokens

Workspace auto-detects only when the token sees exactly one. Otherwise the doctor lists
your workspaces — pin one:

```json
"env": { "ASANA_WORKSPACE_GID": "<your-workspace-gid>" }
```

or pass `workspace` on individual calls.

## Environment reference

| Var | Meaning | Default |
|---|---|---|
| `ASANA_PAT` | token (wins over Keychain/file) | — |
| `ASANA_WORKSPACE_GID` | skip auto-detect | auto when unambiguous |
| `ASANA_DEFAULT_USER` | default scope for reads | `me` |
| `ASANA_DEFAULT_ASSIGNEE` | default assignee for created tasks | `me` |
| `ASANA_MCP_TOOLS` | `all` \| `read` \| `write` \| comma-list | `all` |
| `ASANA_MCP_KEYCHAIN_SERVICE` | Keychain service name | `asana-mcp` |
| `ASANA_MCP_CONFIG` | config file path | `~/.asana-mcp.json` |
