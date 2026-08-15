// Default opt_fields per resource — rich reads by default; every read tool accepts an
// `opt_fields` override.
// ─── Default opt_fields (rich reads; callers can override via opt_fields) ─────

export const TASK_FIELDS = [
  'name', 'resource_type', 'completed', 'completed_at', 'created_at', 'modified_at',
  'due_on', 'due_at', 'start_on', 'assignee.name', 'assignee.gid',
  'projects.name', 'projects.gid', 'memberships.section.name', 'memberships.section.gid',
  'memberships.project.name', 'tags.name', 'tags.gid', 'parent.name', 'parent.gid',
  'num_subtasks', 'notes', 'permalink_url',
  'custom_fields.name', 'custom_fields.gid', 'custom_fields.type', 'custom_fields.display_value',
];
export const PROJECT_FIELDS = ['name', 'gid', 'archived', 'team.name', 'current_status.text', 'owner.name', 'created_at', 'modified_at', 'permalink_url'];
export const PROJECT_FIELDS_FULL = [
  ...PROJECT_FIELDS, 'notes', 'color', 'default_view', 'due_on', 'start_on',
  'custom_field_settings.custom_field.name', 'custom_field_settings.custom_field.gid',
  'custom_field_settings.custom_field.type', 'custom_field_settings.custom_field.enum_options.name',
  'custom_field_settings.custom_field.enum_options.gid',
];
export const SECTION_FIELDS = ['name', 'gid', 'created_at'];
export const USER_FIELDS = ['name', 'gid', 'email', 'resource_type'];
export const TEAM_FIELDS = ['name', 'gid', 'description'];
export const TAG_FIELDS = ['name', 'gid', 'color', 'notes'];
export const STORY_FIELDS = ['gid', 'created_at', 'created_by.name', 'text', 'type', 'resource_subtype'];
export const ATTACHMENT_FIELDS = ['name', 'resource_type', 'resource_subtype', 'download_url', 'permanent_url', 'host', 'created_at', 'size'];
export const STATUS_FIELDS = ['title', 'text', 'status_type', 'created_at', 'created_by.name'];
export const PORTFOLIO_FIELDS = ['name', 'gid', 'color', 'owner.name', 'created_at', 'permalink_url'];
export const DEP_FIELDS = ['name', 'gid', 'completed', 'due_on', 'assignee.name'];
export const CFS_FIELDS = [
  'is_important', 'custom_field.name', 'custom_field.gid', 'custom_field.resource_subtype',
  'custom_field.type', 'custom_field.description',
  'custom_field.enum_options.name', 'custom_field.enum_options.gid', 'custom_field.enum_options.enabled',
];
