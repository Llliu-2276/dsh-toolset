/**
 * Tool names every conversation carries regardless of the selected workbench.
 *
 * `present` and `skill` are provided by agent presets that may not be mounted
 * (for example a minimal headless profile); callers filter the list against the
 * tools actually registered before restricting, so a missing name is not an
 * error.
 */
export const CORE_TOOLS = Object.freeze([
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "pwsh",
  "job_list",
  "job_output",
  "job_kill",
  "ask_user_question",
  "present",
  "todo_write",
  "skill",
  "compress",
  "decompress",
  "search_context",
  "acp_status",
]);

/** The tool this plugin registers so a model can ask for a tool it cannot see. */
export const REQUEST_TOOL = "request_tool";

/** Session events persisted as plugin records. */
export const SELECTED_EVENT = "plugin:dsh-toolset/selected";
export const FROZEN_EVENT = "plugin:dsh-toolset/frozen";
