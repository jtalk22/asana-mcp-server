// Runtime configuration — resolved once at startup, never hard-coded.
//
// Resolution order (first hit wins):
//   PAT        ASANA_PAT env  →  macOS Keychain (service ASANA_MCP_KEYCHAIN_SERVICE, default
//              "asana-mcp")  →  ~/.asana-mcp.json {"pat": "..."}
//   workspace  ASANA_WORKSPACE_GID env  →  auto-detected when the PAT sees exactly ONE
//              workspace  →  otherwise per-call `workspace` argument is required
//   defaults   ASANA_DEFAULT_USER (reads that scope to a person; default "me"),
//              ASANA_DEFAULT_ASSIGNEE (writes that create tasks; default "me")
//   surface    ASANA_MCP_TOOLS = "all" | "read" | "write" | comma-list of tool names
//
// Nothing here talks to Asana except detectWorkspace(), which is called by the server
// after the transport is up (so a missing network never blocks `--version`/`--help`).

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ASANA_BASE = 'https://app.asana.com/api/1.0';

function readKeychain(service) {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readConfigFile() {
  const p = process.env.ASANA_MCP_CONFIG || join(homedir(), '.asana-mcp.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
    throw new Error(`Could not parse ${p}: ${e.message}`);
  }
}

export function resolvePat() {
  const file = readConfigFile();
  const service = process.env.ASANA_MCP_KEYCHAIN_SERVICE || file.keychain_service || 'asana-mcp';
  const pat = process.env.ASANA_PAT || readKeychain(service) || file.pat || null;
  const source = process.env.ASANA_PAT ? 'env:ASANA_PAT'
    : readKeychain(service) ? `keychain:${service}`
    : file.pat ? 'file:~/.asana-mcp.json'
    : null;
  return { pat, source };
}

export const config = {
  pat: null,
  patSource: null,
  workspaceGid: process.env.ASANA_WORKSPACE_GID || null,
  workspaceSource: process.env.ASANA_WORKSPACE_GID ? 'env:ASANA_WORKSPACE_GID' : null,
  workspaceCandidates: null,   // filled by detectWorkspace(); array when the token sees >1
  workspaceDetection: null,    // in-flight promise so early tool calls can await it
  workspaceError: null,
  defaultUser: process.env.ASANA_DEFAULT_USER || 'me',
  defaultAssignee: process.env.ASANA_DEFAULT_ASSIGNEE || 'me',
  toolFilter: process.env.ASANA_MCP_TOOLS || 'all',
};

// Load the PAT into config. Throws with a setup hint when nothing is found.
export function loadPat() {
  const { pat, source } = resolvePat();
  if (!pat) {
    throw new Error(
      'No Asana Personal Access Token found. Set ASANA_PAT, or run `asana-mcp --setup` ' +
      '(stores it in the macOS Keychain under "asana-mcp"), or write ~/.asana-mcp.json {"pat":"..."}. ' +
      'Create one at https://app.asana.com/0/my-apps.'
    );
  }
  config.pat = pat;
  config.patSource = source;
  return config;
}

// Auto-detect the workspace when the PAT sees exactly one. Leaves config.workspaceGid null
// (and returns the list) when it sees several — callers must then pass `workspace`.
export function detectWorkspace(fetchImpl = fetch) {
  if (config.workspaceGid) return Promise.resolve({ gid: config.workspaceGid, source: config.workspaceSource, workspaces: null });
  if (config.workspaceDetection) return config.workspaceDetection;
  config.workspaceDetection = (async () => {
    try {
      const res = await fetchImpl(`${ASANA_BASE}/workspaces?opt_fields=name,gid`, {
        headers: { Authorization: `Bearer ${config.pat}`, Accept: 'application/json' },
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.errors?.map((e) => e.message).join('; ') || res.statusText;
        throw new Error(`Asana API ${res.status} while listing workspaces: ${msg}`);
      }
      const workspaces = json.data || [];
      config.workspaceCandidates = workspaces;
      if (workspaces.length === 1) {
        config.workspaceGid = workspaces[0].gid;
        config.workspaceSource = `auto:${workspaces[0].name}`;
      }
      return { gid: config.workspaceGid, source: config.workspaceSource, workspaces };
    } catch (e) {
      config.workspaceError = e.message;
      throw e;
    }
  })();
  return config.workspaceDetection;
}

// Await an in-flight detection (bounded) so a tool call that lands during startup does
// not fail spuriously. Never throws — requireWorkspace() produces the actionable error.
export async function workspaceReady(timeoutMs = 10_000) {
  if (config.workspaceGid || !config.workspaceDetection) return;
  await Promise.race([
    config.workspaceDetection.catch(() => {}),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

// Resolve the workspace for a call, or fail with an actionable message.
export function requireWorkspace(args = {}) {
  const gid = args.workspace || config.workspaceGid;
  if (gid) return gid;
  const c = config.workspaceCandidates;
  let why;
  if (Array.isArray(c) && c.length > 1) {
    why = `this token sees ${c.length} workspaces (${c.map((w) => `${w.name}=${w.gid}`).join(', ')})`;
  } else if (Array.isArray(c) && c.length === 0) {
    why = 'this token sees no workspaces';
  } else if (config.workspaceError) {
    why = `workspace auto-detect failed: ${config.workspaceError}`;
  } else {
    why = 'workspace auto-detect has not completed';
  }
  throw new Error(`workspace required: pass \`workspace\` or set ASANA_WORKSPACE_GID — ${why} (run \`asana-mcp --doctor\`).`);
}
