# Troubleshooting

The failures below all come from real usage. Most return HTTP 200 or a misleading 400 —
knowing the shape saves the hour.

## "workspace required" on every call

Your token sees more than one workspace, so nothing auto-detects. `--doctor` lists them;
set `ASANA_WORKSPACE_GID` or pass `workspace` per call.

## 400 "Rich text should be wrapped in `<body>` tag" / notes saved EMPTY

Asana requires every rich-text field wrapped in a single `<body>` root and accepts only a
small tag whitelist (`a em strong u s code pre ol ul li blockquote hr` — **not** `h1-h6`,
`b`, `i`, `p`, `div`, and not even `<br>`). This server sanitizes `html_notes` on
`set_html_notes`, `create_task`, `create_subtask`, `batch_update`, `bulk_update`, and
`triage_inbox` items — headings become `<strong>`, paragraphs become blank lines, `<br>`
becomes `\n`. Pass `sanitize: false` on `set_html_notes` if you're sending
already-whitelisted markup and want it untouched.

## Comments render my HTML as literal text

That's Asana: the `/stories` endpoint escapes `html_text` wholesale. `asana_add_comment`
takes plain text on purpose. Literal two-character `\n` sequences in comment/notes text
are converted to real newlines centrally (a recurring JSON double-escape slip).

## `start_on` "doesn't stick"

`start_on` requires `due_on` to be set first. `asana_set_dates` orders the writes; if you
set dates through raw REST yourself, set `due_on` before `start_on`.

## Date custom fields look overdue but never flag (or vice versa)

The API returns date custom fields as full ISO timestamps (`2026-07-26T00:00:00.000Z`).
Anything that compares them as `YYYY-MM-DD` strings must normalize first —
`asana_board_rollup` does, and reports WHICH field fired per overdue task.

## `asana_my_tasks` → 403 for a teammate

A Personal Access Token can read only its OWNER's My Tasks list. For anyone else use
`asana_user_queue` (assignee route — works for any user the token can see), or
`asana_search_tasks` / `asana_list_tasks` with `assignee`.

## Search results stop at 100

Asana's search API hard-caps at 100 results with no pagination. Tools built on it
(`asana_search_tasks`, `asana_morning_brief`) report `truncated: true` when they hit the
cap. For complete queues use `asana_user_queue` or the paginated list tools.

## Custom field write "succeeded" but the value is wrong

Two upstream traps this server absorbs: **date** fields need `{"date": "YYYY-MM-DD"}`
objects (bare strings rejected — auto-wrapped here) and **multi_enum** needs an ARRAY of
option GIDs. If you write through other tooling, check both.

## `batch_ops` PUT did nothing (HTTP 200)

Upstream: Asana's `/batch` endpoint discards `data` on PUT and drops `opt_fields` /
`completed_since` on GET. That's why every write tool here uses the direct endpoint;
`asana_batch_ops` is for plain GETs only, as its description says.

## Rate limits (429)

Free workspaces: 150 requests/min; paid: 1,500/min. The client honors `Retry-After` with
one bounded retry. Long bulk loops on free workspaces: keep batches under ~100 tasks/min.

## A task I "added to a section" landed in the wrong column

Upstream: `addProject`'s `section` parameter is unreliable. `asana_add_to_project` does
the documented 2-step (addProject, then explicit `addTask` on the section) — if you write
raw REST, do the same.
