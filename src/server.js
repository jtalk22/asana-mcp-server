#!/usr/bin/env node
// stdio MCP server entrypoint. `npx -y @jtalk22/asana-mcp` lands here via src/cli.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, loadPat, detectWorkspace, workspaceReady } from '../lib/config.js';
import { TOOLS, filterTools, ANNOTATION_COUNTS } from '../lib/tools.js';
import { handleTool } from '../lib/handlers.js';

export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;

export function buildServer({ tools = TOOLS } = {}) {
  const server = new McpServer(
    { name: 'asana-mcp', version: VERSION },
    { capabilities: { tools: {} } },
  );
  const surface = filterTools(config.toolFilter, tools);
  const names = new Set(surface.map((t) => t.name));

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: surface }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      if (!names.has(name)) throw new Error(`Unknown tool: ${name}`);
      await workspaceReady(); // early calls wait for auto-detect instead of failing spuriously
      const result = await handleTool(name, args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error.message }, null, 2) }],
        isError: true,
      };
    }
  });
  return { server, surface };
}

export async function main() {
  loadPat();
  const { server, surface } = buildServer();
  // Kick off workspace auto-detect BEFORE the handshake; tool calls await it (bounded).
  const detection = detectWorkspace().catch(() => null);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `asana-mcp v${VERSION} on stdio — ${surface.length}/${ANNOTATION_COUNTS.tools} tools ` +
    `(${ANNOTATION_COUNTS.read_only} read-only, ${ANNOTATION_COUNTS.destructive} destructive-annotated) · PAT via ${config.patSource}`,
  );
  const det = await detection;
  if (det?.gid) console.error(`asana-mcp: workspace ${det.gid} (${det.source})`);
  else if (det) console.error(`asana-mcp: token sees ${det.workspaces?.length ?? '?'} workspaces — pass \`workspace\` per call or set ASANA_WORKSPACE_GID`);
  else console.error(`asana-mcp: workspace detection failed (${config.workspaceError}) — calls will need an explicit \`workspace\``);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
