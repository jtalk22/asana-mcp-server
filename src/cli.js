#!/usr/bin/env node
// asana-mcp CLI: --doctor | --setup | --tools | --version | --help | (default) run the stdio server.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { config, loadPat, resolvePat, detectWorkspace, ASANA_BASE } from '../lib/config.js';
import { TOOLS, ANNOTATION_COUNTS, filterTools } from '../lib/tools.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

function help() {
  console.log(`asana-mcp v${VERSION} — Change Asana without opening Asana.

Usage:
  asana-mcp                 run the stdio MCP server (what your MCP client launches)
  asana-mcp --doctor        check token, identity, workspaces, tool surface
  asana-mcp --setup         store a Personal Access Token (Keychain on macOS, else ~/.asana-mcp.json)
  asana-mcp --tools         list tool names (respects ASANA_MCP_TOOLS)
  asana-mcp --version

Env:
  ASANA_PAT                 token (wins over Keychain/file)
  ASANA_WORKSPACE_GID       skip auto-detect (required when the token sees >1 workspace)
  ASANA_DEFAULT_USER        default scope for reads ("me")
  ASANA_DEFAULT_ASSIGNEE    default assignee for created tasks ("me")
  ASANA_MCP_TOOLS           all | read | write | comma-list of tool names
  ASANA_MCP_KEYCHAIN_SERVICE  Keychain service name (default "asana-mcp")
  ASANA_MCP_CONFIG          path to config JSON (default ~/.asana-mcp.json)

Get a token: https://app.asana.com/0/my-apps  →  Personal access tokens.`);
}

async function doctor() {
  const out = { version: VERSION, node: process.version, ok: true, checks: [] };
  const push = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.ok = false; };
  const { pat, source } = resolvePat();
  push('token', !!pat, pat ? `found via ${source}` : 'no token (ASANA_PAT / Keychain "asana-mcp" / ~/.asana-mcp.json)');
  if (pat) {
    config.pat = pat; config.patSource = source;
    try {
      const me = await (await fetch(`${ASANA_BASE}/users/me?opt_fields=name,email,gid`, {
        headers: { Authorization: `Bearer ${pat}` } })).json();
      if (me.errors) push('auth', false, me.errors.map((e) => e.message).join('; '));
      else push('auth', true, `${me.data.name} <${me.data.email}> (${me.data.gid})`);
    } catch (e) { push('auth', false, e.message); }
    try {
      const { gid, source: wsrc, workspaces } = await detectWorkspace();
      push('workspace', !!gid, gid ? `${gid} (${wsrc})` : `token sees ${workspaces?.length} workspaces — set ASANA_WORKSPACE_GID: ${(workspaces || []).map((w) => `${w.name}=${w.gid}`).join(', ')}`);
    } catch (e) { push('workspace', false, e.message); }
  }
  let surface;
  try { surface = filterTools(config.toolFilter); push('tools', true, `${surface.length}/${ANNOTATION_COUNTS.tools} exposed (ASANA_MCP_TOOLS=${config.toolFilter}); ${ANNOTATION_COUNTS.read_only} read-only, ${ANNOTATION_COUNTS.destructive} destructive-annotated`); }
  catch (e) { push('tools', false, e.message); }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

async function setup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Create a Personal Access Token at https://app.asana.com/0/my-apps (Personal access tokens → Create new token).');
  const pat = (await rl.question('Paste your Asana PAT: ')).trim();
  rl.close();
  if (!pat) { console.error('No token entered.'); process.exit(1); }
  const me = await (await fetch(`${ASANA_BASE}/users/me?opt_fields=name,email`, { headers: { Authorization: `Bearer ${pat}` } })).json();
  if (me.errors) { console.error('Token rejected:', me.errors.map((e) => e.message).join('; ')); process.exit(1); }
  const service = process.env.ASANA_MCP_KEYCHAIN_SERVICE || 'asana-mcp';
  if (process.platform === 'darwin' && !has('--file')) {
    try { execFileSync('security', ['delete-generic-password', '-s', service], { stdio: 'ignore' }); } catch {}
    execFileSync('security', ['add-generic-password', '-s', service, '-a', 'asana-mcp', '-w', pat, '-U'], { stdio: 'ignore' });
    console.log(`Stored in macOS Keychain (service "${service}") for ${me.data.name} <${me.data.email}>.`);
  } else {
    const p = process.env.ASANA_MCP_CONFIG || join(homedir(), '.asana-mcp.json');
    const existing = existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...existing, pat }, null, 2), { mode: 0o600 });
    console.log(`Stored in ${p} (mode 600) for ${me.data.name} <${me.data.email}>.`);
  }
  console.log('Next: add to your MCP client —\n  { "asana": { "command": "npx", "args": ["-y", "@jtalk22/asana-mcp"] } }\nthen `asana-mcp --doctor`.');
}

if (has('--help') || has('-h')) help();
else if (has('--version') || has('-v')) console.log(VERSION);
else if (has('--tools')) console.log(filterTools(config.toolFilter).map((t) => t.name).join('\n'));
else if (has('--doctor')) await doctor();
else if (has('--setup')) await setup();
else {
  const { main } = await import('./server.js');
  await main();
}
