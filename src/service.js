import { Service } from "@deepseek-ai/cordis";
import { WorkbenchStore } from "./store.js";

/**
 * Cordis service (`ctx.workbenches`) wrapping the pure store.
 * The store itself has no cordis dependency so it can be unit-tested with a
 * plain `{ emit }` context.
 */
export class WorkbenchService extends Service {
  #store;

  constructor(ctx, options) {
    super(ctx, "workbenches");
    this.#store = new WorkbenchStore(ctx, options);
  }

  get file() {
    return this.#store.file;
  }

  get config() {
    return this.#store.config;
  }

  get degraded() {
    return this.#store.degraded;
  }

  get readOnly() {
    return this.#store.readOnly;
  }

  get lastSelectedId() {
    return this.#store.lastSelectedId;
  }

  reload() {
    return this.#store.reload();
  }

  snapshot() {
    return this.#store.snapshot();
  }

  list() {
    return this.#store.list();
  }

  has(id) {
    return this.#store.has(id);
  }

  benchById(id) {
    return this.#store.benchById(id);
  }

  resolve(benchId) {
    return this.#store.resolve(benchId);
  }

  ownerOf(tool) {
    return this.#store.ownerOf(tool);
  }

  create(name) {
    return this.#store.create(name);
  }

  rename(id, name) {
    return this.#store.rename(id, name);
  }

  remove(id) {
    return this.#store.remove(id);
  }

  setTools(kind, benchId, tools) {
    return this.#store.setTools(kind, benchId, tools);
  }

  moveToGlobal(tools) {
    return this.#store.moveToGlobal(tools);
  }

  setLastSelected(id) {
    return this.#store.setLastSelected(id);
  }
}
