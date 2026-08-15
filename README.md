<div align="center">

<h1>Asana MCP Server</h1>

<p><strong>Change Asana without opening Asana.</strong></p>

<p>Custom fields that stick, section moves, start dates, rich notes, and bulk edits — the writes the official MCP still can't do, over a plain Personal Access Token.</p>

```bash
npx -y @jtalk22/asana-mcp --setup
```

<p><kbd>Claude Code</kbd> <kbd>Claude Desktop</kbd> <kbd>Cursor</kbd> <kbd>Copilot</kbd> <kbd>Windsurf</kbd> <kbd>Gemini CLI</kbd> <kbd>Codex CLI</kbd> <kbd>any stdio MCP client</kbd></p>

</div>

<p align="center">
  <a href="#why-this-exists">Why this exists</a> ·
  <a href="#install">Install</a> ·
  <a href="#75-tools-read-act-design">75 tools</a> ·
  <a href="#composites-one-call-one-answer">Composites</a> ·
  <a href="#honest-limits">Honest limits</a> ·
  <a href="docs/API.md">API reference</a>
</p>

---

## Why this exists

Asana ships an official MCP server. It's OAuth-only, and its tool surface went from 44 tools (V1) to ~26 (V2). As of mid-2026 it cannot:

| You ask the agent to… | Official MCP (V2) | This server |
|---|---|---|
| Set a custom field when creating a task | Not supported — confirmed by Asana staff on the forum (May 2026, "no timeline") | `asana_create_task` / `asana_set_custom_fields`, with the `{"date": …}` wrapper and `multi_enum` arrays handled |
| Move a task to another section | No section operations | `asana_move_section`, `asana_bulk_move_section`, `asana_add_to_project` with reliable section placement (2-step, because `addProject`'s `section` param is not) |
| Set a start date | `start_on` not exposed | `asana_set_dates` (orders `due_on` first — `start_on` silently fails otherwise) |
| Write rich-text task notes | No `html_notes` on tasks | `asana_set_html_notes` with the `<body>`-root fix and a whitelist sanitizer (`<h2>`/`<p>`/`<b>` won't 400 or render as escaped text) |
| Edit 60 tasks at once | Bulk caps at 50, no `/batch` | `asana_bulk_update` / `asana_bulk_move_section` — paginated loops that continue past individual failures and report per-task results |
| Search on a free workspace | `search_tasks` is Premium-only | `asana_typeahead` + paginated list tools work on every tier |
| Build the board itself | No schema tools | `asana_create_custom_field`, `asana_add_enum_option`, `asana_add_field_to_project`, sections, templates + async-job polling |

No OAuth app to register, no admin queue: create a [Personal Access Token](https://app.asana.com/0/my-apps), run `--setup`, done. Local-first — the server talks only to `app.asana.com`; nothing else, ever.

## Install

**1. Get a token** — [app.asana.com/0/my-apps](https://app.asana.com/0/my-apps) → Personal access tokens → Create. Then either:

```bash
npx -y @jtalk22/asana-mcp --setup    # stores it in the macOS Keychain (or ~/.asana-mcp.json, mode 600)
```

or export `ASANA_PAT` yourself.

**2. Add the server** to your MCP client:

```json
{
  "mcpServers": {
    "asana": {
      "command": "npx",
      "args": ["-y", "@jtalk22/asana-mcp"]
    }
  }
}
```

Claude Code one-liner: `claude mcp add asana -- npx -y @jtalk22/asana-mcp`

**3. Verify:**

```bash
npx -y @jtalk22/asana-mcp --doctor   # token → identity → workspace → tool surface, as JSON
```

Workspace is auto-detected when your token sees exactly one. Tokens that see several: set `ASANA_WORKSPACE_GID` (the doctor lists your options) or pass `workspace` per call.

## 75 tools: read, act, design

- **26 reads** — tasks, projects, sections, users, teams, tags, stories, subtasks, dependencies, attachments, statuses, portfolios, typeahead (name→GID), cross-board duplicate detection that knows a multi-homed task is *not* a duplicate.
- **40 writes** — create/update/complete/assign, comments, followers, tags, dependencies, memberships, section moves, dates (`start_on` done right), custom fields (dates wrapped, `multi_enum` arrays), rich notes (sanitized), attachments (100MB uploads), bulk ops, project statuses, portfolios, templates with async-job polling, and `asana_set_notes_safe` for boards where automations rewrite what you just wrote.
- **6 schema/design tools** — create custom fields, extend dropdowns, attach fields to projects, sections, reorder: the agent can *build* the board, not just fill it.
- **3 destructive** — `delete_task` / `delete_project` / `delete_section` refuse to run without `confirm: true`.
- **Local file boundary** — `attach_file` requires `confirm: true` and only reads from the current directory or `ASANA_MCP_FILE_ROOTS`.
- **Read-only batch** — `batch_ops` rejects every non-GET action at both schema and runtime layers.

Every tool declares [MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations) — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, titles. Clients that honor them (Claude Code does) auto-allow reads in plan mode, parallelize them safely, and gate the destructive three.

Trim the advertised surface with `ASANA_MCP_TOOLS=read` (30 tools), `write`, or a comma-list — a triage agent doesn't need delete tools in its context.

Full inputs and semantics: [docs/API.md](docs/API.md).

## Composites: one call, one answer

Five tools that replace ten-call round-trips, built from running real boards daily:

- **`asana_morning_brief`** — incomplete tasks bucketed overdue / due-today / upcoming / blocked-by-dependency, one call.
- **`asana_user_queue`** — one person's FULL queue, paginated past the API's 100-result search cap, bucketed by due date with per-project counts. The "what is X sitting on?" call.
- **`asana_portfolio_rollup`** — per-project health (incomplete / overdue / completed-this-week + status) across a portfolio or project list. `include_archived: true` catches the open tasks hiding on archived boards — every default listing skips them.
- **`asana_board_rollup`** — one board grouped by section, any number custom field summed per section ("Deal $", "Claim $"), deadline fields checked for overdue **by name** — fields resolve live from the board's own settings, nothing hard-coded.
- **`asana_triage_inbox`** — bulk-create from a triaged list (the bulk CREATE the API doesn't have), per-item overrides, continues past failures.

## Honest limits

- Asana's search API caps at 100 results with no pagination. Tools built on it say so (`truncated: true`) instead of pretending the tail doesn't exist; `asana_user_queue` and the list tools paginate past it where the REST API allows.
- The `/batch` endpoint silently discards PUT bodies and GET options upstream — so this server doesn't route writes through it. `asana_batch_ops` exists for GET-with-default-fields only, and its description says exactly that.
- Comment rich text (`html_text` on stories) is downgraded to escaped plaintext *by Asana* — comments here are plain text by design rather than silently ugly.
- Date custom fields come back as full ISO timestamps; overdue math normalizes to `YYYY-MM-DD` before comparing (a silent all-clear bug we hit and fixed).
- A PAT reads only its *own* My Tasks (others 403) — `asana_user_queue` uses the assignee route that works for anyone.

More in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Security

Your PAT has the same access as your Asana login. It's read from `ASANA_PAT`, the macOS Keychain (`asana-mcp`), or `~/.asana-mcp.json` (written mode 600) — never logged, never sent anywhere but `api.asana.com`'s host. No telemetry, no phone-home; read [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci && npm test          # 16 unit tests, no token needed
npm run doctor              # live check against your workspace
npm run api-docs            # regenerate docs/API.md from lib/tools.js
```

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). MIT.

---

<p align="center">Also by the same author: <a href="https://github.com/jtalk22/slack-mcp-server"><code>@jtalk22/slack-mcp</code></a> — catch up on Slack without reading it.</p>
