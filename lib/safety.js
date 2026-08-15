import { realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, relative, resolve, basename } from 'node:path';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function expandHome(filePath, homeDir) {
  if (filePath === '~') return homeDir;
  if (filePath.startsWith('~/')) return resolve(homeDir, filePath.slice(2));
  return filePath;
}

function isWithinRoot(filePath, rootPath) {
  const rel = relative(rootPath, filePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeDisplayName(value) {
  const cleaned = basename(String(value)).replace(/[\r\n"]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('file_name must contain a usable filename');
  }
  return cleaned;
}

export async function validateUploadFile({
  filePath,
  fileName,
  confirm,
  allowedRootsEnv = process.env.ASANA_MCP_FILE_ROOTS,
  cwd = process.cwd(),
  homeDir = process.env.HOME,
  maxBytes = MAX_UPLOAD_BYTES,
}) {
  if (confirm !== true) {
    return {
      ok: false,
      gate: 'C14',
      error: 'asana_attach_file reads a local file and uploads it to Asana. The file was NOT uploaded. Review file_path, then re-call with confirm:true.',
    };
  }
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('file_path must be a non-empty path');
  }
  if (!homeDir && filePath.startsWith('~')) {
    throw new Error('Cannot expand ~ because HOME is not set; pass an absolute file_path instead');
  }

  const candidatePath = resolve(expandHome(filePath, homeDir));
  const resolvedPath = await realpath(candidatePath);
  const rootInputs = (allowedRootsEnv || cwd)
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowedRoots = await Promise.all(rootInputs.map((root) => realpath(resolve(expandHome(root, homeDir)))));

  if (!allowedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    throw new Error(
      `Refusing to upload ${resolvedPath}: it is outside ASANA_MCP_FILE_ROOTS (${allowedRoots.join(', ')}).`
    );
  }

  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) throw new Error(`Refusing to upload ${resolvedPath}: path is not a regular file`);
  if (fileStat.size > maxBytes) {
    throw new Error(`Refusing to upload ${resolvedPath}: ${fileStat.size} bytes exceeds the ${maxBytes}-byte limit`);
  }

  return {
    ok: true,
    resolvedPath,
    fileName: safeDisplayName(fileName || basename(resolvedPath)),
    size: fileStat.size,
    allowedRoots,
  };
}

export function normalizeReadOnlyBatchActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions must contain between 1 and 5 GET requests');
  }
  if (actions.length > 5) throw new Error('Batch API supports max 5 actions');

  return actions.map((action, index) => {
    if (action?.method !== 'GET') {
      throw new Error(`Batch action ${index + 1} is ${action?.method || 'missing a method'}; asana_batch_ops accepts GET only`);
    }
    const relativePath = action.relative_path;
    if (
      typeof relativePath !== 'string' ||
      !relativePath.startsWith('/') ||
      relativePath.startsWith('//') ||
      relativePath.includes('..') ||
      /[\r\n\0]/.test(relativePath)
    ) {
      throw new Error(`Batch action ${index + 1} relative_path must be a safe Asana API path beginning with one /`);
    }
    return { method: 'GET', relative_path: relativePath };
  });
}
