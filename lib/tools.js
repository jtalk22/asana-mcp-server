// Tool surface — JSON-schema definitions for every tool, plus MCP annotations applied by rule.
// Handlers live in ./handlers.js and dispatch on `name`; keep the two files in lockstep
// (test/tools-schema.test.js asserts every tool has a handler and vice-versa).
// ─── Tool Definitions ───────────────────────────────────────────────────────

const OPT_FIELDS_PROP = { type: 'array', items: { type: 'string' }, description: 'Override the rich default opt_fields. Pass field paths e.g. ["name","assignee.name","custom_fields.display_value"].' };
const PAGINATION_PROPS = {
  limit: { type: 'number', description: 'Page size (max 100, default 100)' },
  max_pages: { type: 'number', description: 'Max pages to follow (default 20 = 2000 items)' },
};

const TOOLS = [
  // ── Original 9 (write-fixes) ──────────────────────────────────────────────
  {
    name: 'asana_add_to_project',
    description: 'Add a task to a project, optionally placing it in a specific section. Fixes: no MCP tool for addProject + section placement.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID to add' },
        project_gid: { type: 'string', description: 'Target project GID' },
        section_gid: { type: 'string', description: 'Optional section GID within the project' },
      },
      required: ['task_gid', 'project_gid'],
    },
  },
  {
    name: 'asana_move_section',
    description: 'Move a task to a different section within its project. Fixes: no MCP tool for section moves.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID to move' },
        section_gid: { type: 'string', description: 'Target section GID' },
      },
      required: ['task_gid', 'section_gid'],
    },
  },
  {
    name: 'asana_set_custom_fields',
    description: 'Set custom fields on a task using correct type handling. Fixes: multi_enum arrays and date object wrappers that fail via official MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        custom_fields: {
          type: 'object',
          description: 'Map of field_gid → value. Enum: pass option GID string. Multi-enum: pass array of option GID strings. Date: pass "YYYY-MM-DD" string (auto-wrapped). Number: pass number. Text: pass string.',
          additionalProperties: true,
        },
      },
      required: ['task_gid', 'custom_fields'],
    },
  },
  {
    name: 'asana_set_html_notes',
    description: 'Set rich-text notes on a task using html_notes. Fixes: "XML is invalid" error from official MCP.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        html_notes: { type: 'string', description: 'HTML content for task notes. Use <body> as root element.' },
        sanitize: { type: 'boolean', description: 'Auto-fix non-whitelisted HTML (h1-6→strong, b→strong, i→em, p/div→breaks) so it renders in Asana. Default true; clean HTML passes through unchanged.' },
      },
      required: ['task_gid', 'html_notes'],
    },
  },
  {
    name: 'asana_set_dates',
    description: 'Set start_on and/or due_on dates on a task. Fixes: start_on not exposed in official MCP schema, and due_on must be set first.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
        start_on: { type: 'string', description: 'Start date (YYYY-MM-DD). Requires due_on to be set.' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_batch_update',
    description: 'Update multiple task fields in a single REST call. Combines assignee, dates, custom fields, notes, name, and completion.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        name: { type: 'string', description: 'Task name' },
        assignee: { type: 'string', description: 'Assignee GID' },
        due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
        start_on: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        notes: { type: 'string', description: 'Plain text notes' },
        html_notes: { type: 'string', description: 'HTML notes (overrides plain notes)' },
        custom_fields: {
          type: 'object',
          description: 'Custom fields map (same format as asana_set_custom_fields)',
          additionalProperties: true,
        },
        completed: { type: 'boolean', description: 'Mark task complete/incomplete' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_attach_file',
    description: 'Attach a file (evidence PDF, screenshot, document) to an Asana task. Uploads via multipart/form-data. Max 100MB.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID to attach file to' },
        file_path: { type: 'string', description: 'Absolute path to file on disk' },
        file_name: { type: 'string', description: 'Optional display name (defaults to filename from path)' },
      },
      required: ['task_gid', 'file_path'],
    },
  },
  {
    name: 'asana_batch_ops',
    description: 'Execute up to 5 Asana API operations in a single HTTP call. ⚠ GET-with-default-fields ONLY — options (opt_fields/completed_since) + PUT data are dropped by the batch endpoint. For filtered reads use asana_search_tasks/asana_list_*; for writes use the dedicated tools.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Array of actions (max 5). Each: { method, relative_path, data?, options? }',
          items: {
            type: 'object',
            properties: {
              method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
              relative_path: { type: 'string', description: 'API path like /tasks/123' },
              data: { type: 'object', description: 'Request body (for POST/PUT)', additionalProperties: true },
              options: { type: 'object', description: 'Query parameters', additionalProperties: true },
            },
            required: ['method', 'relative_path'],
          },
          maxItems: 5,
        },
      },
      required: ['actions'],
    },
  },

  // ── READS / discovery ─────────────────────────────────────────────────────
  {
    name: 'asana_get_task',
    description: 'Fetch one task with rich fields (assignee, projects, section memberships, custom fields, notes, subtask count). Override opt_fields for more/less.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        opt_fields: OPT_FIELDS_PROP,
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_search_tasks',
    description: 'Advanced workspace task search with filters: text, assignee, project, section, tag, completed, due/created date ranges, custom-field filters (filters passthrough), sorting. Single page (search API caps at 100, no offset).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Full-text query across task name/notes' },
        assignee: { type: 'string', description: 'Assignee GID (maps to assignee.any). "me" allowed.' },
        project: { type: 'string', description: 'Project GID (projects.any)' },
        section: { type: 'string', description: 'Section GID (sections.any)' },
        tag: { type: 'string', description: 'Tag GID (tags.any)' },
        completed: { type: 'boolean', description: 'Filter by completion state' },
        due_before: { type: 'string', description: 'due_on.before (YYYY-MM-DD)' },
        due_after: { type: 'string', description: 'due_on.after (YYYY-MM-DD)' },
        created_before: { type: 'string', description: 'created_on.before (YYYY-MM-DD)' },
        created_after: { type: 'string', description: 'created_on.after (YYYY-MM-DD)' },
        filters: { type: 'object', description: 'Raw Asana search params passthrough (e.g. {"custom_fields.<field_gid>.greater_than": 500}). Merged verbatim.', additionalProperties: true },
        sort_by: { type: 'string', description: 'created_at | modified_at | completed_at | due_date | likes' },
        sort_ascending: { type: 'boolean', description: 'Sort ascending (default false = newest first)' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        limit: { type: 'number', description: 'Max results (max 100)' },
        opt_fields: OPT_FIELDS_PROP,
      },
    },
  },
  {
    name: 'asana_list_tasks',
    description: 'List tasks by project, section, tag, OR assignee (provide exactly one anchor). Paginated. assignee uses the workspace default.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'List tasks in this project GID' },
        section: { type: 'string', description: 'List tasks in this section GID' },
        tag: { type: 'string', description: 'List tasks with this tag GID' },
        assignee: { type: 'string', description: 'List tasks assigned to this user GID (requires workspace; default: configured/auto-detected)' },
        workspace: { type: 'string', description: 'Workspace GID for assignee queries (default: configured/auto-detected workspace)' },
        completed_since: { type: 'string', description: 'Only tasks modified/incomplete since (ISO 8601 or "now" for only-incomplete)' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_my_tasks',
    description: 'List the TOKEN OWNER\'s My Tasks (user task list). NOTE: a personal PAT can only read its OWN My Tasks — passing another user returns 403. For other users use asana_search_tasks or asana_list_tasks with assignee=<gid>, or asana_user_queue. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: 'User GID (default "me" = token owner).' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        completed_since: { type: 'string', description: 'Only tasks since (ISO 8601 or "now" for only-incomplete)' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_list_projects',
    description: 'List projects in the workspace (or a team). Excludes archived by default; set include_archived=true for all. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        team: { type: 'string', description: 'Team GID — list that team\'s projects instead of the whole workspace' },
        include_archived: { type: 'boolean', description: 'Include archived projects (default false)' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_get_project',
    description: 'Fetch one project with its custom_field_settings (field GIDs + enum option GIDs) AND its sections, merged into one response.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        opt_fields: OPT_FIELDS_PROP,
      },
      required: ['project_gid'],
    },
  },
  {
    name: 'asana_list_sections',
    description: 'List the sections of a project (name + GID), in board order.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        opt_fields: OPT_FIELDS_PROP,
      },
      required: ['project_gid'],
    },
  },
  {
    name: 'asana_list_users',
    description: 'List workspace members (name → GID resolution). Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_get_user',
    description: 'Fetch one user by GID (default "me" = token owner). Returns name, email, GID.',
    inputSchema: {
      type: 'object',
      properties: {
        user_gid: { type: 'string', description: 'User GID or "me" (default "me")' },
        opt_fields: OPT_FIELDS_PROP,
      },
    },
  },
  {
    name: 'asana_list_teams',
    description: 'List teams the token owner belongs to in the workspace/organization. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Organization/workspace GID (default: configured/auto-detected workspace)' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_list_tags',
    description: 'List tags in the workspace (name → GID). Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_list_stories',
    description: 'List a task\'s stories (comments + activity log). text field holds comment bodies. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_list_subtasks',
    description: 'List a task\'s subtasks with rich fields. Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Parent task GID' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_list_dependencies',
    description: 'Return a task\'s dependencies (what it waits on) AND dependents (what waits on it), in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_list_attachments',
    description: 'List a task\'s attachments with download/permanent URLs and sizes.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_list_project_statuses',
    description: 'List a project\'s status updates (status_type, title, text, author). Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
      required: ['project_gid'],
    },
  },
  {
    name: 'asana_list_portfolios',
    description: 'List portfolios owned by a user in the workspace. owner defaults to "me". Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        owner: { type: 'string', description: 'Owner user GID or "me" (default "me")' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
    },
  },
  {
    name: 'asana_get_portfolio',
    description: 'Fetch one portfolio; set include_items=true to also pull its member projects/portfolios.',
    inputSchema: {
      type: 'object',
      properties: {
        portfolio_gid: { type: 'string', description: 'Portfolio GID' },
        include_items: { type: 'boolean', description: 'Also return member items (default false)' },
        opt_fields: OPT_FIELDS_PROP,
      },
      required: ['portfolio_gid'],
    },
  },

  // ── MUTATIONS / collaboration ───────────────────────────────────────────────
  {
    name: 'asana_create_task',
    description: 'Create a general task. Provide either projects[] (workspace inferred) or it lands in the workspace default. Supports assignee, notes/html_notes, dates, followers, tags, custom_fields (dates auto-wrapped).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name' },
        projects: { type: 'array', items: { type: 'string' }, description: 'Project GIDs to add the task to' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace; ignored if projects given)' },
        assignee: { type: 'string', description: 'Assignee GID' },
        notes: { type: 'string', description: 'Plain text notes' },
        html_notes: { type: 'string', description: 'HTML notes (overrides notes)' },
        due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
        start_on: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        followers: { type: 'array', items: { type: 'string' }, description: 'Follower user GIDs' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tag GIDs' },
        custom_fields: { type: 'object', description: 'field_gid → value (dates auto-wrapped)', additionalProperties: true },
      },
      required: ['name'],
    },
  },
  {
    name: 'asana_add_comment',
    description: 'Add a comment (story) to a task. Prefer text (plain, with real newlines; literal "\\n" sequences are auto-converted) — the /stories endpoint escapes html_text into literal tags. Pass html_text only if you accept that.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        text: { type: 'string', description: 'Plain-text comment. Use REAL newline characters for line breaks (literal "\\n" two-char sequences are auto-converted as a safety net).' },
        html_text: { type: 'string', description: 'HTML comment — NOT recommended on /stories (renders escaped)' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_create_subtask',
    description: 'Create a subtask under a parent task.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_gid: { type: 'string', description: 'Parent task GID' },
        name: { type: 'string', description: 'Subtask name' },
        assignee: { type: 'string', description: 'Assignee GID' },
        notes: { type: 'string', description: 'Plain text notes' },
        html_notes: { type: 'string', description: 'HTML notes (overrides notes)' },
        due_on: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
        start_on: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      },
      required: ['parent_gid', 'name'],
    },
  },
  {
    name: 'asana_add_dependency',
    description: 'Mark a task as depending on one or more other tasks (this task waits on them).',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'The dependent task GID' },
        depends_on: { description: 'GID or array of GIDs this task depends on', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['task_gid', 'depends_on'],
    },
  },
  {
    name: 'asana_add_dependent',
    description: 'Mark one or more tasks as dependent on this task (they wait on this one).',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'The blocking task GID' },
        dependent: { description: 'GID or array of GIDs that depend on this task', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['task_gid', 'dependent'],
    },
  },
  {
    name: 'asana_add_tag',
    description: 'Add a tag to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        tag_gid: { type: 'string', description: 'Tag GID' },
      },
      required: ['task_gid', 'tag_gid'],
    },
  },
  {
    name: 'asana_remove_tag',
    description: 'Remove a tag from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        tag_gid: { type: 'string', description: 'Tag GID' },
      },
      required: ['task_gid', 'tag_gid'],
    },
  },
  {
    name: 'asana_add_follower',
    description: 'Add follower(s) to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        followers: { description: 'User GID or array of GIDs', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['task_gid', 'followers'],
    },
  },
  {
    name: 'asana_remove_follower',
    description: 'Remove follower(s) from a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        followers: { description: 'User GID or array of GIDs', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['task_gid', 'followers'],
    },
  },
  {
    name: 'asana_complete_task',
    description: 'Mark a task complete (default) or incomplete (completed:false).',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        completed: { type: 'boolean', description: 'true (default) to complete, false to reopen' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_create_section',
    description: 'Create a new section in a project. Optionally position via insert_before/insert_after (section GIDs).',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        name: { type: 'string', description: 'Section name' },
        insert_before: { type: 'string', description: 'Section GID to insert before' },
        insert_after: { type: 'string', description: 'Section GID to insert after' },
      },
      required: ['project_gid', 'name'],
    },
  },
  {
    name: 'asana_create_project',
    description: 'Create a project. In an org workspace a team GID is required; otherwise the workspace default is used.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        team: { type: 'string', description: 'Team GID (required for org workspaces)' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace; ignored if team given)' },
        notes: { type: 'string', description: 'Project description' },
        color: { type: 'string', description: 'Project color (e.g. "light-green")' },
        public: { type: 'boolean', description: 'Visible to the whole team/workspace' },
        default_view: { type: 'string', description: 'list | board | calendar | timeline' },
      },
      required: ['name'],
    },
  },
  {
    name: 'asana_create_project_status',
    description: 'Post a status update to a project. status_type ∈ on_track|at_risk|off_track|on_hold|complete. text required (html_text optional).',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        status_type: { type: 'string', enum: ['on_track', 'at_risk', 'off_track', 'on_hold', 'complete'], description: 'Status color/type' },
        text: { type: 'string', description: 'Status text (plain)' },
        html_text: { type: 'string', description: 'Status text (HTML; whitelist applies)' },
        title: { type: 'string', description: 'Optional status title' },
        sanitize: { type: 'boolean', description: 'Auto-fix non-whitelisted HTML in html_text (default true).' },
      },
      required: ['project_gid', 'status_type'],
    },
  },
  {
    name: 'asana_duplicate_task',
    description: 'Duplicate a task (template instantiation). include = which fields to copy (array or comma string, e.g. ["notes","assignee","subtasks","dependencies"]). Returns an async job.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Source task GID' },
        name: { type: 'string', description: 'Name for the new task' },
        include: { description: 'Fields to duplicate (array or comma-separated string)', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['task_gid', 'name'],
    },
  },
  {
    name: 'asana_delete_task',
    description: 'DESTRUCTIVE — permanently delete (trash) a task. Requires confirm:true (C13 gate). Without confirm it is a no-op that reports the gate.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID to delete' },
        confirm: { type: 'boolean', description: 'Must be true to actually delete' },
      },
      required: ['task_gid'],
    },
  },

  // ── DESIGN / TEMPLATES / BULK (power + workarounds) ───────────────────────
  {
    name: 'asana_bulk_update',
    description: 'Apply the SAME field changes to MANY tasks in one call (assignee, dates, completed, notes/html_notes, custom_fields). Loops PUT per task, continues past individual failures, returns a per-task summary.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gids: { type: 'array', items: { type: 'string' }, description: 'Task GIDs to update' },
        assignee: { type: 'string', description: 'Assignee GID for all' },
        due_on: { type: 'string', description: 'Due date YYYY-MM-DD for all' },
        start_on: { type: 'string', description: 'Start date YYYY-MM-DD for all' },
        completed: { type: 'boolean', description: 'Completion state for all' },
        notes: { type: 'string', description: 'Plain notes for all' },
        html_notes: { type: 'string', description: 'HTML notes for all (auto-sanitized)' },
        custom_fields: { type: 'object', description: 'field_gid → value for all (dates auto-wrapped)', additionalProperties: true },
      },
      required: ['task_gids'],
    },
  },
  {
    name: 'asana_bulk_move_section',
    description: 'Move MANY tasks into one section in a single call (loops section addTask). Returns a per-task summary. Throughput multiplier for triaging a board column.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gids: { type: 'array', items: { type: 'string' }, description: 'Task GIDs to move' },
        section_gid: { type: 'string', description: 'Target section GID' },
      },
      required: ['task_gids', 'section_gid'],
    },
  },
  {
    name: 'asana_set_notes_safe',
    description: 'Set notes AND survive workspace automations that rewrite the task name / parse dates out of notes text (Rules and some integrations do this): write notes, wait settle_ms, then re-assert name + due_on. Use instead of raw notes edits on automated boards.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string', description: 'Task GID' },
        notes: { type: 'string', description: 'Plain notes' },
        html_notes: { type: 'string', description: 'HTML notes (auto-sanitized; overrides notes)' },
        name: { type: 'string', description: 'Name to re-assert after settle' },
        due_on: { type: 'string', description: 'Due date YYYY-MM-DD to re-assert after settle' },
        settle_ms: { type: 'number', description: 'Wait before re-assert (default 3000; raise toward 8000 on slow automation)' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_list_task_templates',
    description: 'List a project\'s task templates (repeatable task blueprints). Paginated.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
      required: ['project_gid'],
    },
  },
  {
    name: 'asana_instantiate_task_template',
    description: 'Create a new task from a task template (repeatable dispute/ops task). Returns an async job whose new_task holds the created task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_template_gid: { type: 'string', description: 'Task template GID' },
        name: { type: 'string', description: 'Name for the new task' },
      },
      required: ['task_template_gid', 'name'],
    },
  },
  {
    name: 'asana_instantiate_project_template',
    description: 'Create a new project from a project template (repeatable board setup). Returns an async job whose new_project holds the created project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_template_gid: { type: 'string', description: 'Project template GID' },
        name: { type: 'string', description: 'New project name' },
        team: { type: 'string', description: 'Team GID (required in org workspaces)' },
        public: { type: 'boolean', description: 'Visible to team (default false)' },
      },
      required: ['project_template_gid', 'name'],
    },
  },
  {
    name: 'asana_duplicate_project',
    description: 'Duplicate an existing project (clone a board with its structure). include = fields to copy (array or comma string, e.g. ["members","task_notes","task_assignee"]). Returns an async job.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Source project GID' },
        name: { type: 'string', description: 'Name for the new project' },
        team: { type: 'string', description: 'Team GID for the copy' },
        include: { description: 'Fields to copy (array or comma string)', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['project_gid', 'name'],
    },
  },
  {
    name: 'asana_create_custom_field',
    description: 'Create a workspace custom field (design the board schema). resource_subtype ∈ text|number|enum|multi_enum|date|people. For enum/multi_enum pass enum_options:[{name,color?}].',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Field name' },
        resource_subtype: { type: 'string', enum: ['text', 'number', 'enum', 'multi_enum', 'date', 'people'], description: 'Field type' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        enum_options: { type: 'array', description: 'For enum/multi_enum: [{name, color?}]', items: { type: 'object', additionalProperties: true } },
        precision: { type: 'number', description: 'For number fields: decimal places' },
        description: { type: 'string', description: 'Field description' },
      },
      required: ['name', 'resource_subtype'],
    },
  },
  {
    name: 'asana_add_field_to_project',
    description: 'Attach an existing custom field to a project (addCustomFieldSetting), optionally important/positioned. Pairs with asana_create_custom_field to build a board.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        custom_field_gid: { type: 'string', description: 'Custom field GID to attach' },
        is_important: { type: 'boolean', description: 'Show in task header / pin' },
        insert_before: { type: 'string', description: 'Field setting GID to insert before' },
        insert_after: { type: 'string', description: 'Field setting GID to insert after' },
      },
      required: ['project_gid', 'custom_field_gid'],
    },
  },
  {
    name: 'asana_add_enum_option',
    description: 'Add an option to an existing enum/multi_enum custom field (extend a dropdown without recreating the field).',
    inputSchema: {
      type: 'object',
      properties: {
        custom_field_gid: { type: 'string', description: 'Enum/multi_enum field GID' },
        name: { type: 'string', description: 'Option label' },
        color: { type: 'string', description: 'Option color (e.g. "blue")' },
        insert_before: { type: 'string', description: 'Option GID to insert before' },
        insert_after: { type: 'string', description: 'Option GID to insert after' },
      },
      required: ['custom_field_gid', 'name'],
    },
  },
  {
    name: 'asana_add_project_members',
    description: 'Add member(s) to a project (e.g. add a teammate to a new board).',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        members: { description: 'User GID or array of GIDs', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      },
      required: ['project_gid', 'members'],
    },
  },
  {
    name: 'asana_reorder_section',
    description: 'Reorder a section within its project (move a board column). Provide before_section or after_section (section GIDs).',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        section_gid: { type: 'string', description: 'Section GID to move' },
        before_section: { type: 'string', description: 'Place before this section GID' },
        after_section: { type: 'string', description: 'Place after this section GID' },
      },
      required: ['project_gid', 'section_gid'],
    },
  },

  // ── META ──────────────────────────────────────────────────────────────────
  // ── EXTENDED COVERAGE (jobs, typeahead, symmetric ops, portfolio, dedup) ──
  {
    name: 'asana_get_job',
    description: 'Poll an async job by GID (from duplicate_task/duplicate_project/instantiate_* tools). Returns status (not_started|in_progress|succeeded|failed) and the new_task/new_project GID once done.',
    inputSchema: { type: 'object', properties: { job_gid: { type: 'string', description: 'Job GID' }, opt_fields: OPT_FIELDS_PROP }, required: ['job_gid'] },
  },
  {
    name: 'asana_typeahead',
    description: 'Resolve a partial NAME → GID across the workspace for any resource type (task|project|user|tag|portfolio|project_template|goal). Fast lookup when you do not know the GID.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial name to match' },
        resource_type: { type: 'string', enum: ['task', 'project', 'user', 'tag', 'portfolio', 'project_template', 'goal'], description: 'What to search (default project)' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        count: { type: 'number', description: 'Max results (default 20, max 100)' },
        opt_fields: OPT_FIELDS_PROP,
      },
      required: ['query'],
    },
  },
  {
    name: 'asana_remove_from_project',
    description: 'Remove a task from a project (un-add a board card). Symmetric with asana_add_to_project.',
    inputSchema: { type: 'object', properties: { task_gid: { type: 'string' }, project_gid: { type: 'string' } }, required: ['task_gid', 'project_gid'] },
  },
  {
    name: 'asana_set_parent',
    description: 'Re-parent a task: make it a subtask of parent_gid, or detach to top level (parent_gid:null). Optional insert_before/insert_after sibling GIDs.',
    inputSchema: {
      type: 'object',
      properties: {
        task_gid: { type: 'string' },
        parent_gid: { type: ['string', 'null'], description: 'New parent task GID, or null to detach' },
        insert_before: { type: 'string' }, insert_after: { type: 'string' },
      },
      required: ['task_gid'],
    },
  },
  {
    name: 'asana_update_project',
    description: 'Update a project: name, notes, color, archived, public, default_view, dates.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string' }, name: { type: 'string' }, notes: { type: 'string' },
        color: { type: 'string' }, archived: { type: 'boolean' }, public: { type: 'boolean' },
        default_view: { type: 'string' }, due_on: { type: 'string' }, start_on: { type: 'string' },
      },
      required: ['project_gid'],
    },
  },
  {
    name: 'asana_update_section',
    description: 'Rename a section.',
    inputSchema: { type: 'object', properties: { section_gid: { type: 'string' }, name: { type: 'string' } }, required: ['section_gid', 'name'] },
  },
  {
    name: 'asana_remove_field_from_project',
    description: 'Detach a custom field from a project (removeCustomFieldSetting). Symmetric with asana_add_field_to_project.',
    inputSchema: { type: 'object', properties: { project_gid: { type: 'string' }, custom_field_gid: { type: 'string' } }, required: ['project_gid', 'custom_field_gid'] },
  },
  {
    name: 'asana_get_custom_field',
    description: 'Fetch one custom field by GID — type, precision, and full enum_options (name+GID) list.',
    inputSchema: { type: 'object', properties: { custom_field_gid: { type: 'string' }, opt_fields: OPT_FIELDS_PROP }, required: ['custom_field_gid'] },
  },
  {
    name: 'asana_list_workspace_custom_fields',
    description: 'List ALL custom fields defined in the workspace (design discovery — find a field GID to attach to a board). Paginated.',
    inputSchema: { type: 'object', properties: { workspace: { type: 'string' }, opt_fields: OPT_FIELDS_PROP, ...PAGINATION_PROPS } },
  },
  {
    name: 'asana_create_portfolio',
    description: 'Create a portfolio (group projects for North-Star-style tracking).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, workspace: { type: 'string' }, color: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'asana_add_to_portfolio',
    description: 'Add a project/portfolio item to a portfolio.',
    inputSchema: { type: 'object', properties: { portfolio_gid: { type: 'string' }, item_gid: { type: 'string', description: 'Project or portfolio GID to add' } }, required: ['portfolio_gid', 'item_gid'] },
  },
  {
    name: 'asana_remove_from_portfolio',
    description: 'Remove an item from a portfolio.',
    inputSchema: { type: 'object', properties: { portfolio_gid: { type: 'string' }, item_gid: { type: 'string' } }, required: ['portfolio_gid', 'item_gid'] },
  },
  {
    name: 'asana_get_workspace',
    description: 'Fetch workspace metadata (name, is_organization, email_domains).',
    inputSchema: { type: 'object', properties: { workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' }, opt_fields: OPT_FIELDS_PROP } },
  },
  {
    name: 'asana_find_duplicates',
    description: 'Find TRUE duplicate tasks. Dedupes by GID FIRST — one task on N boards = multi_homed (shared membership, reported separately, NOT a dup; deleting it removes the real task from EVERY board) — then groups DISTINCT gids by name. Scan one project/section, or projects[] for cross-board. Returns {multi_homed, true_duplicate_clusters}. Read-only — reason before you delete.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Single project GID to scan' },
        projects: { type: 'array', items: { type: 'string' }, description: 'Multiple project GIDs — cross-board dedup' },
        section: { type: 'string', description: 'Section GID (instead of whole project)' },
        include_completed: { type: 'boolean', description: 'Include completed tasks (default false)' },
        max_pages: { type: 'number' },
      },
    },
  },
  {
    name: 'asana_delete_project',
    description: 'DESTRUCTIVE — permanently delete a project. Requires confirm:true (C13 gate). No-op + gate message otherwise.',
    inputSchema: { type: 'object', properties: { project_gid: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['project_gid'] },
  },
  {
    name: 'asana_delete_section',
    description: 'DESTRUCTIVE — delete a section (Asana requires it be empty, or moves its tasks out). Requires confirm:true (C13 gate).',
    inputSchema: { type: 'object', properties: { section_gid: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['section_gid'] },
  },

  // ── META ──────────────────────────────────────────────────────────────────
  {
    name: 'asana_get_custom_field_settings',
    description: 'Fetch a project\'s custom field settings — live field GIDs, types, and enum option GIDs. Use this to derive field/option GIDs live instead of trusting hand-coded maps that drift.',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Project GID' },
        opt_fields: OPT_FIELDS_PROP,
        ...PAGINATION_PROPS,
      },
      required: ['project_gid'],
    },
  },

  // ── COMPOSITE / Tier 1 (one-call orchestration over the primitives above) ──
  {
    name: 'asana_morning_brief',
    description: 'COMPOSITE: one-call daily brief — incomplete tasks bucketed into overdue / due_today / upcoming (within horizon_days) + blocked (due-window tasks waiting on an incomplete dependency), with a summary count. Defaults to "me"; pass user=<gid> for a teammate or user="all" for the whole workspace. Built on the search API (caps at 100 by due date).',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: 'Assignee GID to scope to (default "me"). "all" = no assignee filter (whole workspace).' },
        horizon_days: { type: 'number', description: 'How many days ahead "upcoming" reaches (default 7)' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
      },
    },
  },
  {
    name: 'asana_portfolio_rollup',
    description: 'COMPOSITE: per-project health across a portfolio — incomplete, overdue, and completed-in-window counts + current status, sorted by overdue. Scope via projects:[gids] (best), portfolio_gid, or default to all non-archived workspace projects (capped at max_projects). One task-list call per project; caps are reported, never silent.',
    inputSchema: {
      type: 'object',
      properties: {
        projects: { type: 'array', items: { type: 'string' }, description: 'Explicit project GIDs to roll up (recommended — cheapest + exact scope)' },
        portfolio_gid: { type: 'string', description: 'Roll up the projects in this portfolio instead' },
        window_days: { type: 'number', description: '"completed in window" lookback in days (default 7)' },
        max_projects: { type: 'number', description: 'Cap on projects scanned when no explicit list (default 20)' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
      },
    },
  },
  {
    name: 'asana_triage_inbox',
    description: 'COMPOSITE: bulk-create tasks from a triaged list in ONE call (fills the gap — no bulk CREATE existed). The model reads the inbox/note, extracts items, and passes them here. Per-item project/assignee/section/due override the defaults; default_assignee falls back to ASANA_DEFAULT_ASSIGNEE, else "me". Continues past individual failures; returns a per-item created/failed summary with permalinks.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Tasks to create. Each: { title (required), notes?, html_notes?, project?, section?, assignee?, due_on? }',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Task name' },
              notes: { type: 'string', description: 'Plain text notes' },
              html_notes: { type: 'string', description: 'HTML notes (auto-sanitized; overrides notes)' },
              project: { type: 'string', description: 'Project GID (overrides default_project)' },
              section: { type: 'string', description: 'Section GID (overrides default_section)' },
              assignee: { type: 'string', description: 'Assignee GID (overrides default_assignee)' },
              due_on: { type: 'string', description: 'Due date YYYY-MM-DD' },
            },
            required: ['title'],
          },
        },
        default_assignee: { type: 'string', description: 'Assignee GID for items without one (default: ASANA_DEFAULT_ASSIGNEE, else "me")' },
        default_project: { type: 'string', description: 'Project GID for items without one' },
        default_section: { type: 'string', description: 'Section GID for items without one (requires a project)' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
      },
      required: ['items'],
    },
  },
  {
    name: 'asana_user_queue',
    description: 'COMPOSITE: one person\'s FULL incomplete queue — paginated (NOT capped at 100 like the search API), bucketed by due (overdue / due_today / this_week / later / no_due) with a per-project count map. Default user = "me"; pass user=<gid> for a teammate (the PAT-owner-only restriction on My Tasks does not apply — this uses /tasks?assignee=). The right call for "what is X sitting on?" and hand-off reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', description: 'Assignee GID or "me" (default "me")' },
        workspace: { type: 'string', description: 'Workspace GID (default: configured/auto-detected workspace)' },
        max_pages: { type: 'number', description: 'Max pages of tasks to follow (default 10 = 1,000 tasks)' },
      },
    },
  },
  {
    name: 'asana_board_rollup',
    description: 'COMPOSITE: roll up ONE board (project) — active tasks grouped by section, an amount custom field summed per section and in total (e.g. "Deal $", "Claim $"), an optional secondary amount, and every task whose deadline (any named date custom fields + due_on) has passed, with days overdue and WHICH field fired. Ranked by amount descending. Fields may be given by GID or by exact name (resolved live via the project\'s custom_field_settings, so nothing is hard-coded).',
    inputSchema: {
      type: 'object',
      properties: {
        project_gid: { type: 'string', description: 'Board (project) GID' },
        amount_field: { type: 'string', description: 'Number custom field to sum — GID or exact name (optional)' },
        secondary_amount_field: { type: 'string', description: 'Second number field to report alongside (optional, e.g. a realistic/expected value)' },
        deadline_fields: { type: 'array', items: { type: 'string' }, description: 'Date custom fields (GID or exact name) to check for overdue; due_on is always checked' },
        status_field: { type: 'string', description: 'Enum custom field to surface per task (GID or exact name; optional)' },
        include_completed: { type: 'boolean', description: 'Include completed tasks (default false)' },
        max_pages: { type: 'number', description: 'Max pages of tasks (default 5 = 500 tasks)' },
      },
      required: ['project_gid'],
    },
  },
];

// ─── MCP tool annotations (readOnlyHint / destructiveHint / idempotentHint / openWorldHint) ─
// Claude Code derives isReadOnly() / isConcurrencySafe() / isDestructive() for an MCP tool
// straight from `annotations` (verified in the 2.1.233 binary: `isReadOnly(){return
// O.annotations?.readOnlyHint??!1}`). ABSENT ⇒ treated as a write: plan mode prompts on
// every asana_get_*/asana_list_* call and read tools never run concurrently. Applied by
// rule after the array so a new tool picks up its hints from its name; override per-tool
// by setting `annotations` on the entry itself (spread last, so it wins).
const READ_ONLY_TOOLS = new Set([
  ...TOOLS.map((t) => t.name).filter((n) => /^asana_(get_|list_)/.test(n)),
  'asana_search_tasks', 'asana_my_tasks', 'asana_find_duplicates', 'asana_typeahead',
  // Composites that only READ (triage_inbox creates tasks — deliberately not here)
  'asana_morning_brief', 'asana_user_queue', 'asana_portfolio_rollup', 'asana_board_rollup',
]);
// Irreversible without a re-create: the C13-gated deletes only. remove_* (tag/follower/
// membership) is reversible by the matching add_* and stays non-destructive.
const DESTRUCTIVE_TOOLS = new Set(['asana_delete_task', 'asana_delete_project', 'asana_delete_section']);
// Same call twice ⇒ same end state (sets/moves/adds-to/completes/updates); creators,
// comments, uploads, duplicates, instantiations and batch/triage are NOT idempotent.
const IDEMPOTENT_WRITE_RE = /^asana_(set_|move_|bulk_move_|bulk_update|reorder_|update_|complete_|add_to_|add_tag|add_follower|add_field_to_|add_project_members|add_dependency|add_dependent|remove_|delete_)/;
const titleFor = (name) => name.replace(/^asana_/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
for (const t of TOOLS) {
  const ro = READ_ONLY_TOOLS.has(t.name);
  t.annotations = {
    title: titleFor(t.name),
    readOnlyHint: ro,
    destructiveHint: DESTRUCTIVE_TOOLS.has(t.name),
    idempotentHint: ro || IDEMPOTENT_WRITE_RE.test(t.name),
    openWorldHint: true, // every tool talks to app.asana.com
    ...(t.annotations || {}),
  };
}
const ANNOTATION_COUNTS = {
  tools: TOOLS.length,
  read_only: TOOLS.filter((t) => t.annotations.readOnlyHint).length,
  destructive: TOOLS.filter((t) => t.annotations.destructiveHint).length,
};
export { TOOLS, READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS, ANNOTATION_COUNTS };

// ASANA_MCP_TOOLS profile filter: "all" (default) | "read" | "write" | comma-list of names.
// Lets a client mount a read-only surface (e.g. for a triage agent) without a second server.
export function filterTools(profile = 'all', tools = TOOLS) {
  const p = String(profile || 'all').trim();
  if (!p || p === 'all') return tools;
  if (p === 'read') return tools.filter((t) => t.annotations.readOnlyHint);
  if (p === 'write') return tools.filter((t) => !t.annotations.readOnlyHint);
  const wanted = new Set(p.split(',').map((s) => s.trim()).filter(Boolean));
  const unknown = [...wanted].filter((n) => !tools.some((t) => t.name === n));
  if (unknown.length) throw new Error(`ASANA_MCP_TOOLS names unknown tools: ${unknown.join(', ')}`);
  return tools.filter((t) => wanted.has(t.name));
}
