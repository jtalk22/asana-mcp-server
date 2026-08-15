// Thin Asana REST client — every tool goes through these helpers, so pagination,
// error shaping, date wrapping and bulk semantics are decided in ONE place.
import { config, ASANA_BASE } from './config.js';

// Rate limits (Asana: 150 req/min free, 1,500/min paid) come back as 429 + Retry-After.
// One bounded retry keeps a bulk loop alive without turning into a hammer.
const MAX_RETRY_AFTER_MS = 30_000;
async function fetchWithRetry(url, init, attempt = 0) {
  const response = await fetch(url, init);
  if (response.status === 429 && attempt === 0) {
    const ra = Number(response.headers.get('retry-after'));
    const waitMs = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000, MAX_RETRY_AFTER_MS);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchWithRetry(url, init, attempt + 1);
  }
  return response;
}

export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) sp.set(k, v.join(','));
    else if (typeof v === 'boolean') sp.set(k, v ? 'true' : 'false');
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Mutations (POST/PUT/DELETE) — returns json.data
export async function asanaRequest(path, options = {}) {
  const url = `${ASANA_BASE}${path}`;
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.pat}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const json = await response.json();
  if (!response.ok) {
    const errMsg = json.errors?.map(e => e.message).join('; ') || response.statusText;
    throw new Error(`Asana API ${response.status}: ${errMsg}`);
  }
  return json.data;
}

// GET — returns the full envelope { data, next_page? }
export async function asanaGetRaw(path, params = {}) {
  const url = `${ASANA_BASE}${path}${qs(params)}`;
  const response = await fetchWithRetry(url, {
    headers: { 'Authorization': `Bearer ${config.pat}`, 'Accept': 'application/json' },
  });
  const json = await response.json();
  if (!response.ok) {
    const errMsg = json.errors?.map(e => e.message).join('; ') || response.statusText;
    throw new Error(`Asana API ${response.status}: ${errMsg}`);
  }
  return json;
}

// GET single object / unpaginated — returns json.data
export async function asanaGet(path, params = {}) {
  return (await asanaGetRaw(path, params)).data;
}

// GET collection, following next_page.offset (Asana caps pages at 100).
export async function asanaList(path, params = {}, opts = {}) {
  const maxPages = opts.maxPages ?? 20;
  const all = [];
  let offset;
  let pages = 0;
  do {
    const p = { limit: 100, ...params };
    if (offset) p.offset = offset;
    const json = await asanaGetRaw(path, p);
    if (Array.isArray(json.data)) all.push(...json.data);
    offset = json.next_page?.offset;
    pages++;
  } while (offset && pages < maxPages);
  return { data: all, pages, truncated: !!offset };
}

// Common list-with-defaults+pagination shape returned to the caller.
export async function listPaged(path, args, defaultFields, extraParams = {}) {
  const params = {
    opt_fields: args.opt_fields || defaultFields,
    limit: args.limit || 100,
    ...extraParams,
  };
  const { data, truncated, pages } = await asanaList(path, params, { maxPages: args.max_pages || 20 });
  return { count: data.length, pages, truncated, data };
}

// Date custom fields need a {"date":"YYYY-MM-DD"} wrapper even via REST.
export function wrapDates(custom_fields) {
  const out = {};
  for (const [k, v] of Object.entries(custom_fields)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = { date: v };
    else out[k] = v;
  }
  return out;
}


// Run an async op over many ids, collecting per-item ok/error. Never aborts the
// batch on a single failure — shared by all bulk_* tools.
export async function bulkLoop(ids, fn) {
  const results = [];
  for (const id of ids) {
    try { await fn(id); results.push({ gid: id, ok: true }); }
    catch (e) { results.push({ gid: id, ok: false, error: e.message }); }
  }
  const succeeded = results.filter(r => r.ok).length;
  return { ok: succeeded === results.length, succeeded, failed: results.length - succeeded, results };
}

// Uniform shape for the async-job-returning tools (duplicate_*, instantiate_*).
export function jobResult(job) {
  const out = { ok: true, job_gid: job.gid, status: job.status };
  if (job.new_task) out.new_task = job.new_task;
  if (job.new_project) out.new_project = job.new_project;
  return out;
}
