// Tool handlers — ONE dispatch function over the primitives in ./asana-client.js.
// Every case returns plain JSON; the server wraps it. Errors throw and are reported
// with isError so the calling model can react.
import { readFileSync } from 'node:fs';
import { config, requireWorkspace as ws, ASANA_BASE } from './config.js';
import {
  asanaRequest, asanaGet, asanaGetRaw, asanaList, listPaged, wrapDates, bulkLoop, jobResult,
} from './asana-client.js';
import { sanitizeAsanaHtml, unescapeLiteralNewlines } from './html.js';
import { normalizeReadOnlyBatchActions, validateUploadFile } from './safety.js';
import {
  TASK_FIELDS, PROJECT_FIELDS, PROJECT_FIELDS_FULL, SECTION_FIELDS, USER_FIELDS, TEAM_FIELDS,
  TAG_FIELDS, STORY_FIELDS, ATTACHMENT_FIELDS, STATUS_FIELDS, PORTFOLIO_FIELDS, DEP_FIELDS, CFS_FIELDS,
} from './fields.js';

// ─── Composite-tool helpers (morning_brief / user_queue / portfolio_rollup / board_rollup / triage_inbox) ───

// Local-calendar date (NOT UTC) — Asana due_on is date-only and users think in their own calendar;
// toISOString() rolls to tomorrow after ~7-8pm. getFullYear/getMonth/getDate are local.
function localYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Day arithmetic anchored at local noon to dodge DST edges.
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localYMD(d);
}
// Slim a rich task record down to the fields a brief/handoff surface actually shows.
function slimTask(t) {
  return {
    gid: t.gid,
    name: t.name,
    due_on: t.due_on || null,
    assignee: t.assignee?.name || null,
    projects: (t.projects || []).map(p => p.name),
    permalink_url: t.permalink_url,
  };
}
// Bucket a YYYY-MM-DD due date relative to today → overdue|due_today|upcoming|later|no_due.
function dueBucket(due_on, today, horizonEnd) {
  if (!due_on) return 'no_due';
  if (due_on < today) return 'overdue';
  if (due_on === today) return 'due_today';
  if (due_on <= horizonEnd) return 'upcoming';
  return 'later';
}


// Tools whose `text` param is a plain-text BODY (writer). Deliberately excludes
// asana_search_tasks, where `text` is a search QUERY and must pass through untouched.
const PLAINTEXT_BODY_TOOLS = new Set(['asana_add_comment', 'asana_create_project_status']);

export async function handleTool(name, args) {
  if (args && typeof args === 'object') {
    // `notes` is a writer field on every tool that accepts it (create_task/subtask/
    // project, batch_update, bulk_update, set_notes_safe).
    if (typeof args.notes === 'string') args.notes = unescapeLiteralNewlines(args.notes);
    if (PLAINTEXT_BODY_TOOLS.has(name) && typeof args.text === 'string') {
      args.text = unescapeLiteralNewlines(args.text);
    }
    if (Array.isArray(args.items)) {
      for (const it of args.items) {
        if (it && typeof it.notes === 'string') it.notes = unescapeLiteralNewlines(it.notes);
      }
    }
  }
  switch (name) {
    // ── Original 9 ──────────────────────────────────────────────────────────
    case 'asana_add_to_project': {
      const { task_gid, project_gid, section_gid } = args;
      // addProject's section param is unreliable — use explicit section move
      await asanaRequest(`/tasks/${task_gid}/addProject`, {
        method: 'POST',
        body: JSON.stringify({ data: { project: project_gid } }),
      });
      if (section_gid) {
        await asanaRequest(`/sections/${section_gid}/addTask`, {
          method: 'POST',
          body: JSON.stringify({ data: { task: task_gid } }),
        });
      }
      return { ok: true, task_gid, project_gid, section_gid };
    }

    case 'asana_move_section': {
      const { task_gid, section_gid } = args;
      return asanaRequest(`/sections/${section_gid}/addTask`, {
        method: 'POST',
        body: JSON.stringify({ data: { task: task_gid } }),
      });
    }

    case 'asana_set_custom_fields': {
      const { task_gid, custom_fields } = args;
      // Date custom fields need {"date": "YYYY-MM-DD"} wrapper even via REST API.
      return asanaRequest(`/tasks/${task_gid}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { custom_fields: wrapDates(custom_fields) } }),
      });
    }

    case 'asana_set_html_notes': {
      const { task_gid } = args;
      const html_notes = args.sanitize === false ? args.html_notes : sanitizeAsanaHtml(args.html_notes);
      return asanaRequest(`/tasks/${task_gid}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { html_notes } }),
      });
    }

    case 'asana_set_dates': {
      const { task_gid, due_on, start_on } = args;
      const data = {};
      // due_on must be set before or alongside start_on
      if (due_on) data.due_on = due_on;
      if (start_on) data.start_on = start_on;
      return asanaRequest(`/tasks/${task_gid}`, {
        method: 'PUT',
        body: JSON.stringify({ data }),
      });
    }

    case 'asana_batch_update': {
      const { task_gid, ...fields } = args;
      const data = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) {
          data[key] = key === 'custom_fields' ? wrapDates(value) : value;
        }
      }
      return asanaRequest(`/tasks/${task_gid}`, {
        method: 'PUT',
        body: JSON.stringify({ data }),
      });
    }

    case 'asana_attach_file': {
      const { task_gid, file_path: filePath, file_name, confirm } = args;
      const upload = await validateUploadFile({ filePath, fileName: file_name, confirm });
      if (!upload.ok) return upload;
      const { resolvedPath, fileName } = upload;

      // Read file and build multipart form
      const fileBuffer = readFileSync(resolvedPath);
      const boundary = `----AsanaOps${Date.now()}`;
      const bodyParts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="parent"\r\n\r\n${task_gid}`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ];

      const header = Buffer.from(bodyParts.join('\r\n') + '\r\n');
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, fileBuffer, footer]);

      const response = await fetch(`${ASANA_BASE}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.pat}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(`Asana API ${response.status}: ${json.errors?.map(e => e.message).join('; ')}`);
      }
      return { ok: true, attachment_gid: json.data.gid, name: json.data.name, download_url: json.data.download_url };
    }

    case 'asana_batch_ops': {
      const batchActions = normalizeReadOnlyBatchActions(args.actions);

      const response = await fetch(`${ASANA_BASE}/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.pat}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { actions: batchActions } }),
      });

      const json = await response.json();
      if (!response.ok) {
        throw new Error(`Asana Batch API ${response.status}: ${JSON.stringify(json.errors || json)}`);
      }
      return json.data;
    }

    // ── READS / discovery ───────────────────────────────────────────────────
    case 'asana_get_task':
      return asanaGet(`/tasks/${args.task_gid}`, { opt_fields: args.opt_fields || TASK_FIELDS });

    case 'asana_search_tasks': {
      const workspace = ws(args);
      const params = {};
      if (args.text) params.text = args.text;
      if (args.assignee) params['assignee.any'] = args.assignee;
      if (args.project) params['projects.any'] = args.project;
      if (args.section) params['sections.any'] = args.section;
      if (args.tag) params['tags.any'] = args.tag;
      if (args.completed !== undefined) params.completed = args.completed;
      if (args.due_before) params['due_on.before'] = args.due_before;
      if (args.due_after) params['due_on.after'] = args.due_after;
      if (args.created_before) params['created_on.before'] = args.created_before;
      if (args.created_after) params['created_on.after'] = args.created_after;
      if (args.sort_by) params.sort_by = args.sort_by;
      if (args.sort_ascending !== undefined) params.sort_ascending = args.sort_ascending;
      params.limit = args.limit || 100;
      params.opt_fields = args.opt_fields || TASK_FIELDS;
      if (args.filters && typeof args.filters === 'object') Object.assign(params, args.filters);
      // Typeahead/search API does NOT support offset pagination — single GET.
      const json = await asanaGetRaw(`/workspaces/${workspace}/tasks/search`, params);
      return { count: json.data?.length || 0, data: json.data };
    }

    case 'asana_list_tasks': {
      const { project, section, tag, assignee } = args;
      const workspace = ws(args);
      const extra = {};
      if (args.completed_since) extra.completed_since = args.completed_since;
      let path;
      if (section) path = `/sections/${section}/tasks`;
      else if (project) path = `/projects/${project}/tasks`;
      else if (tag) path = `/tags/${tag}/tasks`;
      else if (assignee) { path = '/tasks'; extra.assignee = assignee; extra.workspace = workspace; }
      else throw new Error('asana_list_tasks requires one of: project, section, tag, or assignee');
      return listPaged(path, args, TASK_FIELDS, extra);
    }

    case 'asana_my_tasks': {
      const user = args.user || config.defaultUser;
      const workspace = ws(args);
      const utl = await asanaGet(`/users/${user}/user_task_list`, { workspace });
      const extra = {};
      if (args.completed_since) extra.completed_since = args.completed_since;
      const res = await listPaged(`/user_task_lists/${utl.gid}/tasks`, args, TASK_FIELDS, extra);
      return { user, user_task_list: utl.gid, ...res };
    }

    case 'asana_list_projects': {
      const workspace = ws(args);
      const extra = {};
      if (!args.include_archived) extra.archived = false;
      const path = args.team ? `/teams/${args.team}/projects` : `/workspaces/${workspace}/projects`;
      return listPaged(path, args, PROJECT_FIELDS, extra);
    }

    case 'asana_get_project': {
      const { project_gid } = args;
      const project = await asanaGet(`/projects/${project_gid}`, { opt_fields: args.opt_fields || PROJECT_FIELDS_FULL });
      const sections = (await asanaList(`/projects/${project_gid}/sections`, { opt_fields: SECTION_FIELDS, limit: 100 }, { maxPages: 5 })).data;
      return { ...project, sections };
    }

    case 'asana_list_sections':
      return listPaged(`/projects/${args.project_gid}/sections`, args, SECTION_FIELDS);

    case 'asana_list_users': {
      const workspace = ws(args);
      return listPaged(`/workspaces/${workspace}/users`, args, USER_FIELDS);
    }

    case 'asana_get_user':
      return asanaGet(`/users/${args.user_gid || 'me'}`, { opt_fields: args.opt_fields || USER_FIELDS });

    case 'asana_list_teams': {
      const workspace = ws(args);
      return listPaged('/users/me/teams', args, TEAM_FIELDS, { organization: workspace });
    }

    case 'asana_list_tags': {
      const workspace = ws(args);
      return listPaged(`/workspaces/${workspace}/tags`, args, TAG_FIELDS);
    }

    case 'asana_list_stories':
      return listPaged(`/tasks/${args.task_gid}/stories`, args, STORY_FIELDS);

    case 'asana_list_subtasks':
      return listPaged(`/tasks/${args.task_gid}/subtasks`, args, TASK_FIELDS);

    case 'asana_list_dependencies': {
      const { task_gid } = args;
      const dependencies = (await asanaList(`/tasks/${task_gid}/dependencies`, { opt_fields: DEP_FIELDS, limit: 100 }, { maxPages: 5 })).data;
      const dependents = (await asanaList(`/tasks/${task_gid}/dependents`, { opt_fields: DEP_FIELDS, limit: 100 }, { maxPages: 5 })).data;
      return { task_gid, dependencies, dependents };
    }

    case 'asana_list_attachments':
      return listPaged('/attachments', args, ATTACHMENT_FIELDS, { parent: args.task_gid });

    case 'asana_list_project_statuses':
      return listPaged('/status_updates', args, STATUS_FIELDS, { parent: args.project_gid });

    case 'asana_list_portfolios': {
      const workspace = ws(args);
      const owner = args.owner || 'me';
      return listPaged('/portfolios', args, PORTFOLIO_FIELDS, { workspace, owner });
    }

    case 'asana_get_portfolio': {
      const { portfolio_gid } = args;
      const portfolio = await asanaGet(`/portfolios/${portfolio_gid}`, { opt_fields: args.opt_fields || PORTFOLIO_FIELDS });
      if (args.include_items) {
        const items = (await asanaList(`/portfolios/${portfolio_gid}/items`, { opt_fields: PROJECT_FIELDS, limit: 100 }, { maxPages: 10 })).data;
        return { ...portfolio, items };
      }
      return portfolio;
    }

    // ── MUTATIONS / collaboration ─────────────────────────────────────────────
    case 'asana_create_task': {
      const data = { name: args.name };
      if (args.projects && args.projects.length) data.projects = args.projects;
      else data.workspace = ws(args);
      if (args.assignee) data.assignee = args.assignee;
      if (args.html_notes) data.html_notes = sanitizeAsanaHtml(args.html_notes); // same <body>+whitelist fix as set_html_notes
      else if (args.notes) data.notes = args.notes;
      if (args.due_on) data.due_on = args.due_on;
      if (args.start_on) data.start_on = args.start_on;
      if (args.followers && args.followers.length) data.followers = args.followers;
      if (args.tags && args.tags.length) data.tags = args.tags;
      if (args.custom_fields) data.custom_fields = wrapDates(args.custom_fields);
      const task = await asanaRequest('/tasks', { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, task_gid: task.gid, name: task.name, permalink_url: task.permalink_url };
    }

    case 'asana_add_comment': {
      const { task_gid, text, html_text } = args;
      if (!text && !html_text) throw new Error('asana_add_comment requires text or html_text');
      const data = text ? { text } : { html_text };
      const story = await asanaRequest(`/tasks/${task_gid}/stories`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, story_gid: story.gid, text: story.text };
    }

    case 'asana_create_subtask': {
      const data = { name: args.name };
      if (args.assignee) data.assignee = args.assignee;
      if (args.html_notes) data.html_notes = sanitizeAsanaHtml(args.html_notes); // same <body>+whitelist fix as set_html_notes
      else if (args.notes) data.notes = args.notes;
      if (args.due_on) data.due_on = args.due_on;
      if (args.start_on) data.start_on = args.start_on;
      const sub = await asanaRequest(`/tasks/${args.parent_gid}/subtasks`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, subtask_gid: sub.gid, name: sub.name, parent: args.parent_gid };
    }

    case 'asana_add_dependency': {
      const deps = Array.isArray(args.depends_on) ? args.depends_on : [args.depends_on];
      await asanaRequest(`/tasks/${args.task_gid}/addDependencies`, { method: 'POST', body: JSON.stringify({ data: { dependencies: deps } }) });
      return { ok: true, task_gid: args.task_gid, dependencies: deps };
    }

    case 'asana_add_dependent': {
      const deps = Array.isArray(args.dependent) ? args.dependent : [args.dependent];
      await asanaRequest(`/tasks/${args.task_gid}/addDependents`, { method: 'POST', body: JSON.stringify({ data: { dependents: deps } }) });
      return { ok: true, task_gid: args.task_gid, dependents: deps };
    }

    case 'asana_add_tag': {
      await asanaRequest(`/tasks/${args.task_gid}/addTag`, { method: 'POST', body: JSON.stringify({ data: { tag: args.tag_gid } }) });
      return { ok: true, task_gid: args.task_gid, tag: args.tag_gid };
    }

    case 'asana_remove_tag': {
      await asanaRequest(`/tasks/${args.task_gid}/removeTag`, { method: 'POST', body: JSON.stringify({ data: { tag: args.tag_gid } }) });
      return { ok: true, task_gid: args.task_gid, removed_tag: args.tag_gid };
    }

    case 'asana_add_follower': {
      const f = Array.isArray(args.followers) ? args.followers : [args.followers];
      await asanaRequest(`/tasks/${args.task_gid}/addFollowers`, { method: 'POST', body: JSON.stringify({ data: { followers: f } }) });
      return { ok: true, task_gid: args.task_gid, followers: f };
    }

    case 'asana_remove_follower': {
      const f = Array.isArray(args.followers) ? args.followers : [args.followers];
      await asanaRequest(`/tasks/${args.task_gid}/removeFollowers`, { method: 'POST', body: JSON.stringify({ data: { followers: f } }) });
      return { ok: true, task_gid: args.task_gid, removed_followers: f };
    }

    case 'asana_complete_task': {
      const completed = args.completed === undefined ? true : args.completed;
      const t = await asanaRequest(`/tasks/${args.task_gid}`, { method: 'PUT', body: JSON.stringify({ data: { completed } }) });
      return { ok: true, task_gid: args.task_gid, completed: t.completed };
    }

    case 'asana_create_section': {
      const data = { name: args.name };
      if (args.insert_before) data.insert_before = args.insert_before;
      if (args.insert_after) data.insert_after = args.insert_after;
      const s = await asanaRequest(`/projects/${args.project_gid}/sections`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, section_gid: s.gid, name: s.name, project: args.project_gid };
    }

    case 'asana_create_project': {
      const data = { name: args.name };
      if (args.team) data.team = args.team;
      else data.workspace = ws(args);
      if (args.notes) data.notes = args.notes;
      if (args.color) data.color = args.color;
      if (args.public !== undefined) data.public = args.public;
      if (args.default_view) data.default_view = args.default_view;
      const p = await asanaRequest('/projects', { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, project_gid: p.gid, name: p.name, permalink_url: p.permalink_url };
    }

    case 'asana_create_project_status': {
      const data = { parent: args.project_gid, status_type: args.status_type };
      if (args.html_text) data.html_text = args.sanitize === false ? args.html_text : sanitizeAsanaHtml(args.html_text);
      else if (args.text) data.text = args.text;
      else throw new Error('asana_create_project_status requires text or html_text');
      if (args.title) data.title = args.title;
      const s = await asanaRequest('/status_updates', { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, status_gid: s.gid, status_type: s.status_type };
    }

    case 'asana_duplicate_task': {
      const data = { name: args.name };
      if (args.include) data.include = Array.isArray(args.include) ? args.include.join(',') : args.include;
      const job = await asanaRequest(`/tasks/${args.task_gid}/duplicate`, { method: 'POST', body: JSON.stringify({ data }) });
      return jobResult(job);
    }

    case 'asana_delete_task': {
      const { task_gid, confirm } = args;
      if (confirm !== true) {
        return {
          ok: false,
          gate: 'C13',
          error: `asana_delete_task is DESTRUCTIVE and requires confirm:true. Task ${task_gid} was NOT deleted. Re-call with confirm:true to proceed.`,
        };
      }
      await asanaRequest(`/tasks/${task_gid}`, { method: 'DELETE' });
      return { ok: true, deleted: task_gid };
    }

    // ── DESIGN / TEMPLATES / BULK (power + workarounds) ───────────────────────
    case 'asana_bulk_update': {
      const { task_gids } = args;
      const base = {};
      if (args.assignee !== undefined) base.assignee = args.assignee;
      if (args.due_on !== undefined) base.due_on = args.due_on;
      if (args.start_on !== undefined) base.start_on = args.start_on;
      if (args.completed !== undefined) base.completed = args.completed;
      if (args.html_notes !== undefined) base.html_notes = sanitizeAsanaHtml(args.html_notes);
      else if (args.notes !== undefined) base.notes = args.notes;
      if (args.custom_fields) base.custom_fields = wrapDates(args.custom_fields);
      const r = await bulkLoop(task_gids, gid => asanaRequest(`/tasks/${gid}`, { method: 'PUT', body: JSON.stringify({ data: base }) }));
      return { ok: r.ok, updated: r.succeeded, failed: r.failed, results: r.results };
    }

    case 'asana_bulk_move_section': {
      const { task_gids, section_gid } = args;
      const results = [];
      for (const gid of task_gids) {
        try {
          await asanaRequest(`/sections/${section_gid}/addTask`, { method: 'POST', body: JSON.stringify({ data: { task: gid } }) });
          results.push({ gid, ok: true });
        } catch (e) {
          results.push({ gid, ok: false, error: e.message });
        }
      }
      const ok = results.filter(r => r.ok).length;
      return { ok: ok === results.length, moved: ok, failed: results.length - ok, section_gid, results };
    }

    case 'asana_set_notes_safe': {
      const { task_gid } = args;
      const notesData = {};
      if (args.html_notes) notesData.html_notes = sanitizeAsanaHtml(args.html_notes);
      else if (args.notes) notesData.notes = args.notes;
      if (Object.keys(notesData).length) {
        await asanaRequest(`/tasks/${task_gid}`, { method: 'PUT', body: JSON.stringify({ data: notesData }) });
      }
      const settle = args.settle_ms === undefined ? 3000 : args.settle_ms;
      if (settle > 0) await new Promise(r => setTimeout(r, settle));
      const reassert = {};
      if (args.name) reassert.name = args.name;
      if (args.due_on) reassert.due_on = args.due_on;
      let reasserted = null;
      if (Object.keys(reassert).length) {
        reasserted = await asanaRequest(`/tasks/${task_gid}`, { method: 'PUT', body: JSON.stringify({ data: reassert }) });
      }
      return { ok: true, task_gid, settle_ms: settle, reasserted: reassert, name: reasserted?.name, due_on: reasserted?.due_on };
    }

    case 'asana_list_task_templates':
      return listPaged(`/projects/${args.project_gid}/task_templates`, args, ['name', 'gid']);

    case 'asana_instantiate_task_template': {
      const job = await asanaRequest(`/task_templates/${args.task_template_gid}/instantiateTask`, { method: 'POST', body: JSON.stringify({ data: { name: args.name } }) });
      return jobResult(job);
    }

    case 'asana_instantiate_project_template': {
      const data = { name: args.name };
      if (args.team) data.team = args.team;
      if (args.public !== undefined) data.public = args.public;
      const job = await asanaRequest(`/project_templates/${args.project_template_gid}/instantiateProject`, { method: 'POST', body: JSON.stringify({ data }) });
      return jobResult(job);
    }

    case 'asana_duplicate_project': {
      const data = { name: args.name };
      if (args.team) data.team = args.team;
      if (args.include) data.include = Array.isArray(args.include) ? args.include.join(',') : args.include;
      const job = await asanaRequest(`/projects/${args.project_gid}/duplicate`, { method: 'POST', body: JSON.stringify({ data }) });
      return jobResult(job);
    }

    case 'asana_create_custom_field': {
      const data = { workspace: ws(args), name: args.name, resource_subtype: args.resource_subtype };
      if (args.enum_options) data.enum_options = args.enum_options;
      if (args.precision !== undefined) data.precision = args.precision;
      if (args.description) data.description = args.description;
      const f = await asanaRequest('/custom_fields', { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, custom_field_gid: f.gid, name: f.name, resource_subtype: f.resource_subtype, enum_options: f.enum_options };
    }

    case 'asana_add_field_to_project': {
      const data = { custom_field: args.custom_field_gid };
      if (args.is_important !== undefined) data.is_important = args.is_important;
      if (args.insert_before) data.insert_before = args.insert_before;
      if (args.insert_after) data.insert_after = args.insert_after;
      const s = await asanaRequest(`/projects/${args.project_gid}/addCustomFieldSetting`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, project: args.project_gid, custom_field: args.custom_field_gid, setting_gid: s.gid };
    }

    case 'asana_add_enum_option': {
      const data = { name: args.name };
      if (args.color) data.color = args.color;
      if (args.insert_before) data.insert_before = args.insert_before;
      if (args.insert_after) data.insert_after = args.insert_after;
      const o = await asanaRequest(`/custom_fields/${args.custom_field_gid}/enum_options`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, custom_field: args.custom_field_gid, option_gid: o.gid, name: o.name };
    }

    case 'asana_add_project_members': {
      const members = Array.isArray(args.members) ? args.members.join(',') : args.members;
      await asanaRequest(`/projects/${args.project_gid}/addMembers`, { method: 'POST', body: JSON.stringify({ data: { members } }) });
      return { ok: true, project: args.project_gid, members };
    }

    case 'asana_reorder_section': {
      const data = { section: args.section_gid };
      if (args.before_section) data.before_section = args.before_section;
      if (args.after_section) data.after_section = args.after_section;
      await asanaRequest(`/projects/${args.project_gid}/sections/insert`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, project: args.project_gid, section: args.section_gid };
    }

    // ── EXTENDED COVERAGE (jobs, typeahead, symmetric ops, portfolio, dedup) ──
    case 'asana_get_job':
      return asanaGet(`/jobs/${args.job_gid}`, { opt_fields: args.opt_fields || ['resource_subtype', 'status', 'new_task.name', 'new_task.gid', 'new_project.name', 'new_project.gid'] });

    case 'asana_typeahead': {
      const workspace = ws(args);
      const params = { resource_type: args.resource_type || 'project', query: args.query, count: args.count || 20 };
      if (args.opt_fields) params.opt_fields = args.opt_fields;
      const json = await asanaGetRaw(`/workspaces/${workspace}/typeahead`, params);
      return { count: json.data?.length || 0, resource_type: params.resource_type, data: json.data };
    }

    case 'asana_remove_from_project': {
      await asanaRequest(`/tasks/${args.task_gid}/removeProject`, { method: 'POST', body: JSON.stringify({ data: { project: args.project_gid } }) });
      return { ok: true, task_gid: args.task_gid, removed_from: args.project_gid };
    }

    case 'asana_set_parent': {
      const data = { parent: args.parent_gid ?? null };
      if (args.insert_before) data.insert_before = args.insert_before;
      if (args.insert_after) data.insert_after = args.insert_after;
      await asanaRequest(`/tasks/${args.task_gid}/setParent`, { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, task_gid: args.task_gid, parent: args.parent_gid ?? null };
    }

    case 'asana_update_project': {
      const { project_gid, ...fields } = args;
      const data = {};
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) data[k] = v;
      const p = await asanaRequest(`/projects/${project_gid}`, { method: 'PUT', body: JSON.stringify({ data }) });
      return { ok: true, project_gid, name: p.name, archived: p.archived };
    }

    case 'asana_update_section': {
      const s = await asanaRequest(`/sections/${args.section_gid}`, { method: 'PUT', body: JSON.stringify({ data: { name: args.name } }) });
      return { ok: true, section_gid: args.section_gid, name: s.name };
    }

    case 'asana_remove_field_from_project': {
      await asanaRequest(`/projects/${args.project_gid}/removeCustomFieldSetting`, { method: 'POST', body: JSON.stringify({ data: { custom_field: args.custom_field_gid } }) });
      return { ok: true, project: args.project_gid, removed_field: args.custom_field_gid };
    }

    case 'asana_get_custom_field':
      return asanaGet(`/custom_fields/${args.custom_field_gid}`, { opt_fields: args.opt_fields || ['name', 'gid', 'resource_subtype', 'type', 'precision', 'enum_options.name', 'enum_options.gid', 'enum_options.enabled', 'description'] });

    case 'asana_list_workspace_custom_fields': {
      const workspace = ws(args);
      return listPaged(`/workspaces/${workspace}/custom_fields`, args, ['name', 'gid', 'resource_subtype', 'type']);
    }

    case 'asana_create_portfolio': {
      const data = { name: args.name, workspace: ws(args) };
      if (args.color) data.color = args.color;
      const p = await asanaRequest('/portfolios', { method: 'POST', body: JSON.stringify({ data }) });
      return { ok: true, portfolio_gid: p.gid, name: p.name };
    }

    case 'asana_add_to_portfolio': {
      await asanaRequest(`/portfolios/${args.portfolio_gid}/addItem`, { method: 'POST', body: JSON.stringify({ data: { item: args.item_gid } }) });
      return { ok: true, portfolio: args.portfolio_gid, added_item: args.item_gid };
    }

    case 'asana_remove_from_portfolio': {
      await asanaRequest(`/portfolios/${args.portfolio_gid}/removeItem`, { method: 'POST', body: JSON.stringify({ data: { item: args.item_gid } }) });
      return { ok: true, portfolio: args.portfolio_gid, removed_item: args.item_gid };
    }

    case 'asana_get_workspace':
      return asanaGet(`/workspaces/${ws(args)}`, { opt_fields: args.opt_fields || ['name', 'gid', 'is_organization', 'email_domains'] });

    case 'asana_find_duplicates': {
      const { project, section } = args;
      const projects = args.projects || (project ? [project] : null);
      if (!projects && !section) throw new Error('asana_find_duplicates requires project, projects[], or section');
      const sources = section
        ? [{ path: `/sections/${section}/tasks`, src: section }]
        : projects.map(p => ({ path: `/projects/${p}/tasks`, src: p }));
      const all = [];
      for (const s of sources) {
        try {
          const { data } = await asanaList(s.path, { opt_fields: ['name', 'completed', 'due_on', 'assignee.name'], limit: 100 }, { maxPages: args.max_pages || 10 });
          for (const t of data) all.push({ ...t, _src: s.src });
        } catch (e) { /* skip an unreadable source, keep scanning */ }
      }
      const norm = x => (x || '').trim().toLowerCase().replace(/\s+/g, ' ');
      // Collapse multi-homed tasks FIRST: one gid appearing in several project
      // lists is ONE task living on multiple boards — NOT a duplicate. Reading the
      // gid is the nuance; name-grouping alone falsely flags shared memberships
      // (and "deleting the dup" would remove the real task from every board).
      const byGid = {};
      for (const t of all) {
        if (!args.include_completed && t.completed) continue;
        if (!byGid[t.gid]) byGid[t.gid] = { gid: t.gid, name: t.name, completed: t.completed, due_on: t.due_on, assignee: t.assignee?.name, boards: new Set() };
        byGid[t.gid].boards.add(t._src);
      }
      const unique = Object.values(byGid);
      // One task, >=2 boards = multi-homed (shared membership) — reported, not a dup.
      const multi_homed = unique.filter(t => t.boards.size >= 2)
        .map(t => ({ gid: t.gid, name: t.name, boards: [...t.boards], assignee: t.assignee, due_on: t.due_on }));
      // TRUE duplicates: DISTINCT gids that share a normalized name.
      const groups = {};
      for (const t of unique) { const k = norm(t.name); (groups[k] = groups[k] || []).push(t); }
      const clusters = Object.values(groups).filter(v => v.length >= 2)
        .map(v => {
          const boards = [...new Set(v.flatMap(x => [...x.boards]))];
          return {
            name: v[0].name, count: v.length, gids: v.map(x => x.gid), boards, cross_board: boards.length > 1,
            tasks: v.map(x => ({ gid: x.gid, name: x.name, boards: [...x.boards], due_on: x.due_on, assignee: x.assignee })),
          };
        })
        .sort((a, b) => b.count - a.count);
      return {
        scanned: all.length, unique_tasks: unique.length, sources: sources.length,
        multi_homed_count: multi_homed.length, multi_homed,
        true_duplicate_clusters: clusters.length, clusters,
      };
    }

    case 'asana_delete_project': {
      if (args.confirm !== true) return { ok: false, gate: 'C13', error: `asana_delete_project is DESTRUCTIVE and requires confirm:true. Project ${args.project_gid} was NOT deleted.` };
      await asanaRequest(`/projects/${args.project_gid}`, { method: 'DELETE' });
      return { ok: true, deleted_project: args.project_gid };
    }

    case 'asana_delete_section': {
      if (args.confirm !== true) return { ok: false, gate: 'C13', error: `asana_delete_section is DESTRUCTIVE and requires confirm:true. Section ${args.section_gid} was NOT deleted.` };
      await asanaRequest(`/sections/${args.section_gid}`, { method: 'DELETE' });
      return { ok: true, deleted_section: args.section_gid };
    }

    // ── META ────────────────────────────────────────────────────────────────
    case 'asana_get_custom_field_settings':
      return listPaged(`/projects/${args.project_gid}/custom_field_settings`, args, CFS_FIELDS);

    // ── COMPOSITE / Tier 1 ────────────────────────────────────────────────────
    case 'asana_morning_brief': {
      const workspace = ws(args);
      const horizon = Number.isFinite(args.horizon_days) ? args.horizon_days : 7;
      const today = localYMD();
      const horizonEnd = addDays(today, horizon);
      const scope = args.user === 'all' ? null : (args.user || config.defaultUser);
      const params = {
        completed: false,
        'due_on.before': addDays(horizonEnd, 1), // inclusive of horizonEnd
        sort_by: 'due_date',
        sort_ascending: true,
        limit: 100,
        opt_fields: ['name', 'due_on', 'assignee.name', 'projects.name', 'permalink_url',
          'dependencies.gid', 'dependencies.name', 'dependencies.completed'],
      };
      if (scope) params['assignee.any'] = scope;
      const json = await asanaGetRaw(`/workspaces/${workspace}/tasks/search`, params);
      const tasks = json.data || [];
      const buckets = { overdue: [], due_today: [], upcoming: [], blocked: [] };
      for (const t of tasks) {
        const slim = slimTask(t);
        const incompleteDeps = (t.dependencies || []).filter(d => d.completed === false);
        if (incompleteDeps.length) {
          buckets.blocked.push({ ...slim, blocked_by: incompleteDeps.map(d => d.name || d.gid) });
        }
        const b = dueBucket(t.due_on, today, horizonEnd);
        if (b === 'overdue') buckets.overdue.push(slim);
        else if (b === 'due_today') buckets.due_today.push(slim);
        else if (b === 'upcoming') buckets.upcoming.push(slim);
      }
      return {
        as_of: today,
        horizon_days: horizon,
        scope: scope || 'all',
        summary: {
          overdue: buckets.overdue.length,
          due_today: buckets.due_today.length,
          upcoming: buckets.upcoming.length,
          blocked: buckets.blocked.length,
          total: tasks.length,
        },
        overdue: buckets.overdue,
        due_today: buckets.due_today,
        upcoming: buckets.upcoming,
        blocked: buckets.blocked,
        truncated: tasks.length >= 100,
        note: 'Search API caps at 100 by due date; "blocked" cross-cuts the due window (a task may also appear in a due bucket).',
      };
    }

    case 'asana_portfolio_rollup': {
      const workspace = ws(args);
      const today = localYMD();
      const windowDays = Number.isFinite(args.window_days) ? args.window_days : 7;
      const since = addDays(today, -windowDays);
      const cap = Number.isFinite(args.max_projects) ? args.max_projects : 20;
      let projects;
      if (Array.isArray(args.projects) && args.projects.length) {
        projects = args.projects.map(gid => ({ gid }));
      } else if (args.portfolio_gid) {
        projects = await asanaGet(`/portfolios/${args.portfolio_gid}/items`, { opt_fields: 'name' });
      } else {
        // include_archived: archived projects can still hold OPEN tasks that every default
        // listing hides (observed: 135 open tasks parked on archived boards). Opt in to see them.
        const listParams = { workspace, opt_fields: 'name,archived' };
        if (!args.include_archived) listParams.archived = false;
        const { data } = await asanaList('/projects', listParams, { maxPages: 5 });
        projects = args.include_archived ? data : data.filter(p => !p.archived);
      }
      const projectsTruncated = projects.length > cap;
      projects = projects.slice(0, cap);
      const rows = [];
      for (const p of projects) {
        try {
          const proj = await asanaGet(`/projects/${p.gid}`, { opt_fields: 'name,current_status.text,current_status.color,permalink_url,archived' });
          const { data: tasks, truncated } = await asanaList(`/projects/${p.gid}/tasks`, { opt_fields: 'completed,due_on,completed_at' }, { maxPages: 5 });
          let incomplete = 0, overdue = 0, completedInWindow = 0;
          for (const t of tasks) {
            if (!t.completed) { incomplete++; if (t.due_on && t.due_on < today) overdue++; }
            else if (t.completed_at && t.completed_at.slice(0, 10) >= since) completedInWindow++;
          }
          rows.push({
            gid: p.gid, name: proj.name,
            status: proj.current_status?.text || null,
            status_color: proj.current_status?.color || null,
            incomplete, overdue, completed_in_window: completedInWindow,
            tasks_truncated: truncated, permalink_url: proj.permalink_url,
          });
        } catch (e) {
          rows.push({ gid: p.gid, name: p.name || p.gid, error: e.message });
        }
      }
      rows.sort((a, b) => (b.overdue || 0) - (a.overdue || 0));
      return {
        as_of: today,
        window_days: windowDays,
        projects_scanned: rows.length,
        projects_truncated: projectsTruncated,
        totals: {
          incomplete: rows.reduce((s, r) => s + (r.incomplete || 0), 0),
          overdue: rows.reduce((s, r) => s + (r.overdue || 0), 0),
          completed_in_window: rows.reduce((s, r) => s + (r.completed_in_window || 0), 0),
        },
        projects: rows,
      };
    }

    case 'asana_triage_inbox': {
      const workspace = ws(args);
      const items = Array.isArray(args.items) ? args.items : [];
      if (!items.length) return { ok: false, error: 'asana_triage_inbox requires items: [{ title, notes?, project?, assignee?, due_on? }]' };
      const defAssignee = args.default_assignee || config.defaultAssignee;
      const created = [];
      for (const it of items) {
        try {
          const data = { workspace, name: it.title || it.name };
          const assignee = it.assignee || defAssignee;
          if (assignee) data.assignee = assignee;
          if (it.due_on) data.due_on = it.due_on;
          if (it.html_notes) data.html_notes = it.sanitize === false ? it.html_notes : sanitizeAsanaHtml(it.html_notes);
          else if (it.notes) data.notes = it.notes;
          const project = it.project || args.default_project;
          if (project) data.projects = [project];
          const task = await asanaRequest('/tasks?opt_fields=name,permalink_url', {
            method: 'POST', body: JSON.stringify({ data }),
          });
          const section = it.section || args.default_section;
          if (section) {
            await asanaRequest(`/sections/${section}/addTask`, {
              method: 'POST', body: JSON.stringify({ data: { task: task.gid } }),
            });
          }
          created.push({ title: data.name, gid: task.gid, permalink_url: task.permalink_url, ok: true });
        } catch (e) {
          created.push({ title: it.title || it.name, ok: false, error: e.message });
        }
      }
      return {
        ok: created.every(c => c.ok),
        requested: items.length,
        succeeded: created.filter(c => c.ok).length,
        failed: created.filter(c => !c.ok).length,
        created,
      };
    }

    case 'asana_user_queue': {
      const workspace = ws(args);
      const assignee = args.user || config.defaultUser;
      const today = localYMD();
      const weekEnd = addDays(today, 7);
      const { data, truncated } = await asanaList('/tasks', {
        assignee, workspace, completed_since: 'now',
        opt_fields: ['name', 'due_on', 'assignee.name', 'projects.name', 'permalink_url', 'completed'],
      }, { maxPages: args.max_pages || 10 });
      const incomplete = data.filter(t => !t.completed);
      const buckets = { overdue: [], due_today: [], this_week: [], later: [], no_due: [] };
      const byProject = {};
      for (const t of incomplete) {
        const slim = slimTask(t);
        const b = dueBucket(t.due_on, today, weekEnd);
        if (b === 'overdue') buckets.overdue.push(slim);
        else if (b === 'due_today') buckets.due_today.push(slim);
        else if (b === 'upcoming') buckets.this_week.push(slim);
        else if (b === 'later') buckets.later.push(slim);
        else buckets.no_due.push(slim);
        for (const p of (slim.projects.length ? slim.projects : ['(no project)'])) {
          byProject[p] = (byProject[p] || 0) + 1;
        }
      }
      return {
        as_of: today,
        assignee: incomplete[0]?.assignee || assignee,
        summary: {
          total: incomplete.length,
          overdue: buckets.overdue.length,
          due_today: buckets.due_today.length,
          this_week: buckets.this_week.length,
          later: buckets.later.length,
          no_due: buckets.no_due.length,
        },
        by_project: byProject,
        overdue: buckets.overdue,
        due_today: buckets.due_today,
        this_week: buckets.this_week,
        later: buckets.later,
        no_due: buckets.no_due,
        truncated,
      };
    }

    case 'asana_board_rollup': {
      const today = localYMD();
      const board = args.project_gid;
      if (!board) throw new Error('project_gid is required');
      // Resolve field names → GIDs live from the board's own custom_field_settings, so a
      // caller can say amount_field:"Deal $" and nothing is hard-coded anywhere.
      const settings = (await asanaList(`/projects/${board}/custom_field_settings`, {
        opt_fields: ['custom_field.gid', 'custom_field.name', 'custom_field.resource_subtype'],
      }, { maxPages: 3 })).data.map(s => s.custom_field).filter(Boolean);
      const resolveField = (ref, kinds) => {
        if (!ref) return null;
        const hit = settings.find(f => f.gid === ref) || settings.find(f => f.name === ref);
        if (!hit) throw new Error(`custom field "${ref}" not found on project ${board} (have: ${settings.map(f => f.name).join(', ')})`);
        if (kinds && !kinds.includes(hit.resource_subtype)) throw new Error(`custom field "${hit.name}" is ${hit.resource_subtype}, expected ${kinds.join('/')}`);
        return hit;
      };
      const amountF = resolveField(args.amount_field, ['number', 'currency']);
      const secondF = resolveField(args.secondary_amount_field, ['number', 'currency']);
      const statusF = resolveField(args.status_field, ['enum', 'multi_enum', 'text']);
      const deadlineFs = (args.deadline_fields || []).map(r => resolveField(r, ['date']));
      const { data: tasks, truncated } = await asanaList(`/projects/${board}/tasks`, {
        opt_fields: ['name', 'completed', 'due_on', 'permalink_url',
          'memberships.project.gid', 'memberships.section.name',
          'custom_fields.gid', 'custom_fields.name', 'custom_fields.display_value', 'custom_fields.number_value'],
      }, { maxPages: args.max_pages || 5 });
      const active = args.include_completed ? tasks : tasks.filter(t => !t.completed);
      const bySection = {};
      const overdueRows = [];
      const rows = [];
      let totalAmount = 0, totalSecondary = 0;
      const dayOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : null;
      for (const t of active) {
        const membership = (t.memberships || []).find(m => m.project?.gid === board) || t.memberships?.[0];
        const section = membership?.section?.name || '(unsectioned)';
        const cf = t.custom_fields || [];
        const num = (f) => f ? (cf.find(x => x.gid === f.gid)?.number_value ?? null) : null;
        const amount = num(amountF);
        const secondary = num(secondF);
        const status = statusF ? (cf.find(x => x.gid === statusF.gid)?.display_value ?? null) : null;
        if (typeof amount === 'number') totalAmount += amount;
        if (typeof secondary === 'number') totalSecondary += secondary;
        bySection[section] = bySection[section] || { count: 0, amount: 0, secondary: 0 };
        bySection[section].count++;
        if (typeof amount === 'number') bySection[section].amount += amount;
        if (typeof secondary === 'number') bySection[section].secondary += secondary;
        const row = { gid: t.gid, name: t.name, section, completed: !!t.completed, amount, secondary_amount: secondary, status,
          due_on: t.due_on || null, permalink_url: t.permalink_url };
        // Date custom fields come back as full ISO timestamps — normalise to YYYY-MM-DD
        // before comparing, and say WHICH field fired so an overdue row is actionable.
        const overdueOn = [];
        for (const f of deadlineFs) {
          const d = dayOf(cf.find(x => x.gid === f.gid)?.display_value);
          row[f.name] = d;
          if (d && d < today) overdueOn.push({ field: f.name, date: d });
        }
        const dd = dayOf(t.due_on);
        if (dd && dd < today) overdueOn.push({ field: 'due_on', date: dd });
        if (overdueOn.length && !t.completed) {
          row.overdue_on = overdueOn;
          row.days_overdue = Math.max(...overdueOn.map(o => Math.floor((Date.parse(today) - Date.parse(o.date)) / 86400000)));
          overdueRows.push(row);
        }
        rows.push(row);
      }
      rows.sort((a, b) => (b.amount || 0) - (a.amount || 0) || (b.secondary_amount || 0) - (a.secondary_amount || 0));
      const round2 = (n) => Math.round(n * 100) / 100;
      return {
        as_of: today,
        board_gid: board,
        fields: { amount: amountF?.name || null, secondary_amount: secondF?.name || null, status: statusF?.name || null, deadlines: deadlineFs.map(f => f.name) },
        summary: {
          active_tasks: active.length,
          total_amount: round2(totalAmount),
          total_secondary_amount: round2(totalSecondary),
          overdue: overdueRows.length,
        },
        by_section: bySection,
        overdue_tasks: overdueRows,
        tasks: rows,
        truncated,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
