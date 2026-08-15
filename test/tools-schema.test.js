import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, ANNOTATION_COUNTS, READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS, filterTools } from '../lib/tools.js';

test('every tool is well-formed and annotated', () => {
  assert.equal(TOOLS.length, ANNOTATION_COUNTS.tools);
  for (const t of TOOLS) {
    assert.match(t.name, /^asana_[a-z_]+$/, t.name);
    assert.ok(t.description?.length > 12, `${t.name} description`);
    assert.equal(t.inputSchema?.type, 'object', `${t.name} inputSchema`);
    assert.ok(t.annotations, `${t.name} annotations`);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof t.annotations[k], 'boolean', `${t.name} ${k}`);
    }
    assert.ok(t.annotations.title?.length, `${t.name} title`);
  }
});

test('tool names are unique', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('read-only and destructive sets are coherent', () => {
  assert.equal(TOOLS.filter((t) => t.annotations.readOnlyHint).length, ANNOTATION_COUNTS.read_only);
  assert.equal(TOOLS.filter((t) => t.annotations.destructiveHint).length, ANNOTATION_COUNTS.destructive);
  for (const t of TOOLS) {
    assert.ok(!(t.annotations.readOnlyHint && t.annotations.destructiveHint), `${t.name} both RO and destructive`);
  }
  for (const name of DESTRUCTIVE_TOOLS) assert.match(name, /^asana_delete_/);
  // every delete tool is destructive-annotated
  for (const t of TOOLS.filter((t) => t.name.startsWith('asana_delete_'))) {
    assert.ok(t.annotations.destructiveHint, `${t.name} must carry destructiveHint`);
  }
  // spot-truths
  assert.ok(READ_ONLY_TOOLS.has('asana_get_task'));
  assert.ok(!READ_ONLY_TOOLS.has('asana_triage_inbox'), 'triage_inbox CREATES tasks');
});

test('no estate GID literals or names in the advertised surface', () => {
  const advertised = JSON.stringify(TOOLS);
  assert.doesNotMatch(advertised, /\b1[0-9]{15}\b/, 'GID literal leaked into tool schema');
  assert.doesNotMatch(advertised, /gwen|revasser|Dispute/i, 'estate name leaked into tool schema');
});

test('handlers and tools are in lockstep', () => {
  const src = readFileSync(new URL('../lib/handlers.js', import.meta.url), 'utf8');
  const cases = [...src.matchAll(/^    case '(asana_[a-z_]+)':/gm)].map((m) => m[1]);
  assert.equal(new Set(cases).size, cases.length, 'duplicate case');
  const toolNames = new Set(TOOLS.map((t) => t.name));
  for (const c of cases) assert.ok(toolNames.has(c), `handler ${c} has no tool entry`);
  for (const n of toolNames) assert.ok(cases.includes(n), `tool ${n} has no handler`);
});

test('filterTools profiles', () => {
  assert.equal(filterTools('all').length, TOOLS.length);
  assert.equal(filterTools('read').length, ANNOTATION_COUNTS.read_only);
  assert.equal(filterTools('write').length, TOOLS.length - ANNOTATION_COUNTS.read_only);
  assert.deepEqual(filterTools('asana_get_task,asana_create_task').map((t) => t.name).sort(),
    ['asana_create_task', 'asana_get_task']);
  assert.throws(() => filterTools('asana_nope'), /unknown tools/);
});

test('batch schema is GET-only and file uploads disclose their confirmation gate', () => {
  const batch = TOOLS.find((tool) => tool.name === 'asana_batch_ops');
  assert.deepEqual(batch.inputSchema.properties.actions.items.properties.method.enum, ['GET']);
  assert.equal(batch.inputSchema.properties.actions.items.additionalProperties, false);
  assert.equal(batch.inputSchema.properties.actions.minItems, 1);

  const attach = TOOLS.find((tool) => tool.name === 'asana_attach_file');
  assert.ok(attach.inputSchema.properties.confirm);
  assert.match(attach.description, /Requires confirm:true/);
});
