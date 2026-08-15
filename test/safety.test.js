import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeReadOnlyBatchActions, validateUploadFile } from '../lib/safety.js';

test('batch operations accept only safe GET actions', () => {
  assert.deepEqual(
    normalizeReadOnlyBatchActions([{ method: 'GET', relative_path: '/tasks/123' }]),
    [{ method: 'GET', relative_path: '/tasks/123' }]
  );
  assert.throws(
    () => normalizeReadOnlyBatchActions([{ method: 'DELETE', relative_path: '/tasks/123' }]),
    /accepts GET only/
  );
  assert.throws(
    () => normalizeReadOnlyBatchActions([{ method: 'GET', relative_path: '//example.com' }]),
    /safe Asana API path/
  );
  assert.throws(() => normalizeReadOnlyBatchActions([]), /between 1 and 5/);
});

test('file upload requires confirmation and stays inside an allowed root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asana-mcp-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'asana-mcp-outside-'));
  const insideFile = join(root, 'evidence.txt');
  const outsideFile = join(outside, 'private.txt');
  await writeFile(insideFile, 'evidence');
  await writeFile(outsideFile, 'private');

  const gated = await validateUploadFile({ filePath: insideFile, confirm: false, allowedRootsEnv: root });
  assert.equal(gated.ok, false);
  assert.equal(gated.gate, 'C14');

  const accepted = await validateUploadFile({
    filePath: insideFile,
    fileName: 'receipt\n".txt',
    confirm: true,
    allowedRootsEnv: root,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.fileName, 'receipt__.txt');

  await assert.rejects(
    validateUploadFile({ filePath: outsideFile, confirm: true, allowedRootsEnv: root }),
    /outside ASANA_MCP_FILE_ROOTS/
  );
  await assert.rejects(
    validateUploadFile({ filePath: insideFile, confirm: true, allowedRootsEnv: root, maxBytes: 1 }),
    /exceeds the 1-byte limit/
  );

  const linkedFile = join(root, 'linked-private.txt');
  await symlink(outsideFile, linkedFile);
  await assert.rejects(
    validateUploadFile({ filePath: linkedFile, confirm: true, allowedRootsEnv: root }),
    /outside ASANA_MCP_FILE_ROOTS/
  );
});
