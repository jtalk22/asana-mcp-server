# Contributing

Issues and PRs welcome — real usage reports especially (which tool, which call, what Asana
returned).

## Ground rules

- `npm test` green before a PR; add a test when you change behavior.
- One concern per PR. Tool additions need: entry in `lib/tools.js`, case in
  `lib/handlers.js` (the schema↔handler lockstep test enforces the pair), and a line in
  the regenerated `docs/API.md` (`npm run api-docs`).
- No hard-coded workspace/user/project GIDs anywhere — CI greps for 16-digit literals and
  fails. Defaults come from `lib/config.js`.
- Commit messages are checked by `.githooks/commit-msg` (run `bash scripts/setup-git-hooks.sh`
  once after cloning).
- Public wording: `bash scripts/check-public-language.sh` must pass.

## Release flow (maintainer)

1. Bump the version in `package.json`, `package-lock.json`, `server.json` (2 spots) —
   `node scripts/check-version-parity.js` must pass.
2. Tag + GitHub Release `vX.Y.Z` — `publish.yml` publishes to npm with `--provenance`
   and then to the MCP Registry. Never `npm publish` from a laptop; it breaks provenance
   for that version permanently.
