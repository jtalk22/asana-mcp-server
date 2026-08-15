import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// config reads env at import — exercise it in subprocesses so each case is clean.
const run = (env, code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], {
  encoding: 'utf8',
  env: { ...process.env, ASANA_PAT: '', ASANA_WORKSPACE_GID: '', ASANA_MCP_CONFIG: '/nonexistent.json', ASANA_MCP_KEYCHAIN_SERVICE: 'asana-mcp-test-none', ...env },
  cwd: new URL('..', import.meta.url).pathname,
});

test('resolvePat prefers env', () => {
  const out = run({ ASANA_PAT: 'tok123' },
    "import { resolvePat } from './lib/config.js'; const r = resolvePat(); console.log(r.source, r.pat);");
  assert.match(out, /env:ASANA_PAT tok123/);
});

test('loadPat throws an actionable error when nothing is found', () => {
  assert.throws(() => run({},
    "import { loadPat } from './lib/config.js'; loadPat();"), /No Asana Personal Access Token/);
});

test('requireWorkspace: per-call arg wins; missing everything is actionable', () => {
  const out = run({ ASANA_WORKSPACE_GID: 'ws9' },
    "import { requireWorkspace } from './lib/config.js'; console.log(requireWorkspace({})); console.log(requireWorkspace({ workspace: 'override' }));");
  assert.match(out, /ws9\noverride/);
  assert.throws(() => run({},
    "import { requireWorkspace } from './lib/config.js'; requireWorkspace({});"), /workspace required/);
});
