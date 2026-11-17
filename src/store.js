import { CORE_TOOLS } from "./core.js";
import { defaultConfig, loadConfig, normalizeConfig, saveConfig, MAX_NAME_LENGTH } from "./config.js";

let idCounter = 0;

function newBenchId() {
  idCounter = (idCounter + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function requiredName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new Error("工作台名称不能为空");
  if (name.length > MAX_NAME_LENGTH) throw new Error(`工作台名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
  return name;
}

/**
 * Owns the workbench configuration: validation, persistence and queries.
 * Every mutation validates the whole document, writes it atomically and emits
 * `workbench/changed` so the settings UI can refresh.
 */
export class WorkbenchStore {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.file = options.file;
    this.log = options.logger;
    this.config = defaultConfig();
    this.degraded = false;
    this.error = undefined;
    this.missing = true;
    this.reload();
  }

  /** Re-read the configuration file. */
  reload() {
    const loaded = loadConfig(this.file, this.log);
    this.config = loaded.config;
    this.degraded = loaded.degraded;
    this.error = loaded.error;
    this.missing = loaded.missing ?? false;
    return loaded;
  }

  /** True when the file exists but could not be trusted; writes are refused. */
  get readOnly() {
    return this.degraded;
  }

  /** A detached copy of the current configuration. */
  snapshot() {
    return structuredClone(this.config);
  }

  /** Id of the workbench new conversations start with, or null. */
  get lastSelectedId() {
    return this.config.lastSelected;
  }

  /** Whether a workbench with this id currently exists. */
  has(id) {
    return typeof id === "string" && this.config.benches.some((bench) => bench.id === id);
  }

  /** Find a workbench by id. */
  benchById(id) {
    return this.config.benches.find((bench) => bench.id === id);
  }

  /**
   * Resolve the tool set a conversation on this workbench may use.
   * `core` never depends on configuration; `global` and `bench` are copies.
   */
  resolve(benchId) {
    const bench = typeof benchId === "string" ? this.benchById(benchId) : undefined;
    return {
      benchId: bench ? bench.id : null,
      name: bench ? bench.name : null,
      core: [...CORE_TOOLS],
      global: [...this.config.global.tools],
      bench: bench ? [...bench.tools] : [],
    };
  }

  /** Where a tool currently lives: global, a workbench, or nowhere. */
  ownerOf(tool) {
    if (this.config.global.tools.includes(tool)) return { kind: "global" };
    for (const bench of this.config.benches) {
      if (bench.tools.includes(tool)) return { kind: "bench", id: bench.id, name: bench.name };
    }
    return { kind: "unclassified" };
  }

  /** The configuration document handed to the settings UI. */
  list() {
    return { ...this.snapshot(), degraded: this.degraded, error: this.error, file: this.file };
  }

  assertWritable() {
    if (this.degraded) {
      throw new Error(`工作台配置损坏，已停止写入，请先修复或删除 ${this.file}`);
    }
  }

  commit(next, reason) {
    const result = normalizeConfig(next);
    if (!result.ok) {
      const error = new Error(`工作台配置不合法：${result.errors.join("；")}`);
      error.code = "INVALID_CONFIG";
      throw error;
    }
    saveConfig(this.file, result.config);
    this.config = result.config;
    this.degraded = false;
    this.error = undefined;
    this.missing = false;
    this.ctx.emit("workbench/changed", { reason, config: this.snapshot() });
    return reason;
  }

  create(name) {
    this.assertWritable();
    const trimmed = requiredName(name);
    if (this.config.benches.some((bench) => bench.name === trimmed)) {
      throw new Error(`已经有一个叫「${trimmed}」的工作台`);
    }
    const bench = { id: newBenchId(), name: trimmed, tools: [], createdAt: Date.now() };
    this.commit({ ...this.config, benches: [...this.config.benches, bench] }, "create");
    return structuredClone(bench);
  }

  rename(id, name) {
    this.assertWritable();
    const bench = this.benchById(id);
    if (!bench) throw new Error("工作台不存在");
    const trimmed = requiredName(name);
    if (this.config.benches.some((other) => other.id !== id && other.name === trimmed)) {
      throw new Error(`已经有一个叫「${trimmed}」的工作台`);
    }
    this.commit(
      { ...this.config, benches: this.config.benches.map((other) => (other.id === id ? { ...other, name: trimmed } : other)) },
      "rename",
    );
    return this.benchById(id);
  }

  remove(id) {
    this.assertWritable();
    const bench = this.benchById(id);
    if (!bench) throw new Error("工作台不存在");
    this.commit(
      {
        ...this.config,
        benches: this.config.benches.filter((other) => other.id !== id),
        lastSelected: this.config.lastSelected === id ? null : this.config.lastSelected,
      },
      "remove",
    );
    return { removed: structuredClone(bench) };
  }

  /**
   * Replace the tool list of the global workbench or one normal workbench.
   * Moving a tool into one side removes it from the other: global and normal
   * workbenches are exclusive.
   */
  setTools(kind, benchId, tools) {
    this.assertWritable();
    if (!Array.isArray(tools)) throw new Error("tools 必须是数组");
    const wanted = [];
    const seen = new Set();
    for (const item of tools) {
      const name = typeof item === "string" ? item.trim() : "";
      if (name === "" || seen.has(name)) continue;
      seen.add(name);
      wanted.push(name);
    }

    if (kind === "global") {
      const nextBenches = this.config.benches.map((bench) => ({
        ...bench,
        tools: bench.tools.filter((name) => !seen.has(name)),
      }));
      this.commit({ ...this.config, global: { tools: wanted }, benches: nextBenches }, "setTools");
      return { kind, tools: [...wanted] };
    }

    if (kind === "bench") {
      if (!this.has(benchId)) throw new Error("工作台不存在");
      const globalSet = new Set(this.config.global.tools);
      const nextBenches = this.config.benches.map((bench) =>
        bench.id === benchId
          ? { ...bench, tools: wanted.filter((name) => !globalSet.has(name)) }
          : bench,
      );
      this.commit({ ...this.config, benches: nextBenches }, "setTools");
      return { kind, benchId, tools: [...(this.benchById(benchId)?.tools ?? [])] };
    }

    throw new Error(`未知的工作台类型 ${JSON.stringify(kind)}`);
  }

  /**
   * Move tools into the global workbench, removing them from every normal
   * workbench first. Returns which workbenches lost which tools.
   */
  moveToGlobal(tools) {
    this.assertWritable();
    if (!Array.isArray(tools)) throw new Error("tools 必须是数组");
    const wanted = [];
    const seen = new Set();
    for (const item of tools) {
      const name = typeof item === "string" ? item.trim() : "";
      if (name === "" || seen.has(name)) continue;
      seen.add(name);
      wanted.push(name);
    }
    const removedFrom = [];
    for (const bench of this.config.benches) {
      const lost = bench.tools.filter((name) => seen.has(name));
      if (lost.length > 0) removedFrom.push({ id: bench.id, name: bench.name, tools: lost });
    }
    const nextBenches = this.config.benches.map((bench) => ({
      ...bench,
      tools: bench.tools.filter((name) => !seen.has(name)),
    }));
    const globalTools = [...new Set([...this.config.global.tools, ...wanted])];
    this.commit({ ...this.config, global: { tools: globalTools }, benches: nextBenches }, "moveToGlobal");
    return { added: wanted, removedFrom };
  }

  setLastSelected(id) {
    this.assertWritable();
    if (id !== null && id !== undefined && !this.has(id)) throw new Error("工作台不存在");
    const next = id === undefined ? null : id;
    this.commit({ ...this.config, lastSelected: next }, "setLastSelected");
    return next;
  }
}

export { newBenchId };
