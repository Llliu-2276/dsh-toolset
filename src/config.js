import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Name length accepted for a workbench, in Unicode characters. */
export const MAX_NAME_LENGTH = 30;

/** Description length accepted for a workbench, in Unicode characters. */
export const MAX_DESCRIPTION_LENGTH = 200;

/** An empty, valid configuration. */
export function defaultConfig() {
  return { version: 1, lastSelected: null, global: { tools: [] }, benches: [], toolOrder: [] };
}

/**
 * Resolve the configuration file location: `<DSH_HOME>/plugin-data/dsh-toolset/workbenches.json`.
 * @param env - environment to read `DSH_HOME` from.
 */
export function configPath(env = process.env) {
  const home = (env.DSH_HOME ?? "").trim() || join(homedir(), ".dsh");
  return join(home, "plugin-data", "dsh-toolset", "workbenches.json");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolList(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} 必须是数组`);
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${label} 里存在空名字或非字符串`);
      continue;
    }
    const name = item.trim();
    if (seen.has(name)) {
      errors.push(`${label} 里 "${name}" 重复`);
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Validate and normalize a configuration value.
 * @param raw - parsed JSON value.
 * @returns `{ ok, config, errors }`; `config` is a fresh normalized object either way.
 */
export function normalizeConfig(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, config: defaultConfig(), errors: ["配置必须是 JSON 对象"] };
  if (raw.version !== 1) errors.push(`version 必须是 1，实际是 ${JSON.stringify(raw.version)}`);

  const globalRaw = raw.global;
  const globalTools = isPlainObject(globalRaw) ? toolList(globalRaw.tools, "global.tools", errors) : (errors.push("global 必须是对象"), []);

  const benches = [];
  if (!Array.isArray(raw.benches)) {
    errors.push("benches 必须是数组");
  } else {
    const ids = new Set();
    const names = new Set();
    for (const [index, entry] of raw.benches.entries()) {
      if (!isPlainObject(entry)) {
        errors.push(`benches[${index}] 必须是对象`);
        continue;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (id === "") errors.push(`benches[${index}].id 必须是非空字符串`);
      else if (ids.has(id)) errors.push(`工作台 id "${id}" 重复`);
      ids.add(id);

      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (name === "") errors.push(`benches[${index}].name 必须是非空字符串`);
      else if (name.length > MAX_NAME_LENGTH) errors.push(`工作台名称「${name}」超过 ${MAX_NAME_LENGTH} 个字符`);
      else if (names.has(name)) errors.push(`工作台名称「${name}」重复`);
      names.add(name);

      const description = typeof entry.description === "string" ? entry.description.trim() : "";
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push(`工作台「${name}」的介绍超过 ${MAX_DESCRIPTION_LENGTH} 个字符`);
      }

      const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : 0;
      benches.push({
        id,
        name,
        description,
        tools: toolList(entry.tools, `benches[${index}].tools`, errors),
        createdAt,
      });
    }
  }

  const globalSet = new Set(globalTools);
  for (const bench of benches) {
    const overlap = bench.tools.filter((name) => globalSet.has(name));
    if (overlap.length > 0) errors.push(`工作台「${bench.name}」里的工具 ${overlap.join("、")} 同时也在全局工作台`);
  }

  let lastSelected = null;
  if (raw.lastSelected !== undefined && raw.lastSelected !== null) {
    if (typeof raw.lastSelected !== "string") errors.push("lastSelected 必须是字符串或 null");
    else lastSelected = raw.lastSelected;
  }
  if (lastSelected !== null && !benches.some((bench) => bench.id === lastSelected)) lastSelected = null;

  // Display order of the tool cards in the settings page, shared by every
  // workbench so switching one never reshuffles the list. Tools that are not
  // listed keep their alphabetical position after the listed ones.
  const toolOrder = raw.toolOrder === undefined ? [] : toolList(raw.toolOrder, "toolOrder", errors);

  return {
    ok: errors.length === 0,
    config: { version: 1, lastSelected, global: { tools: globalTools }, benches, toolOrder },
    errors,
  };
}

/**
 * Read the configuration file. A missing file is an empty configuration; an
 * unreadable or invalid file is reported as degraded and never overwritten.
 * @param file - configuration path.
 * @param logger - optional diagnostic sink (`{ error }`).
 */
export function loadConfig(file, logger) {
  if (!existsSync(file)) return { config: defaultConfig(), degraded: false, missing: true };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    logger?.error?.(`无法读取工作台配置 ${file}：${String(error)}`);
    return { config: defaultConfig(), degraded: true, error: String(error) };
  }
  const result = normalizeConfig(raw);
  if (!result.ok) {
    const error = result.errors.join("；");
    logger?.error?.(`工作台配置不合法 ${file}：${error}`);
    return { config: defaultConfig(), degraded: true, error };
  }
  return { config: result.config, degraded: false, missing: false };
}

/**
 * Persist a configuration atomically, keeping the previous file as `.bak`.
 * @param file - configuration path.
 * @param config - already validated configuration.
 */
export function saveConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true });
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, text, "utf8");
  if (existsSync(file)) {
    try {
      copyFileSync(file, `${file}.bak`);
    } catch {
      // A missing backup must not block the save; the rename below still applies.
    }
  }
  renameSync(temporary, file);
}
