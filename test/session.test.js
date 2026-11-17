import assert from "node:assert/strict";
import { test } from "node:test";

import { FROZEN_EVENT, SELECTED_EVENT } from "../src/core.js";
import { createSessionRecorder, scanWorkbenchEvents } from "../src/session.js";

test("scanWorkbenchEvents returns the last selection and the last frozen record", () => {
  const events = [
    { type: "turn/start", data: {} },
    { type: SELECTED_EVENT, data: { benchId: "b1", name: "old" } },
    { type: SELECTED_EVENT, data: { benchId: "b2", name: "new" } },
    { type: FROZEN_EVENT, data: { benchId: "b2", name: "new", core: [], global: [], bench: [] } },
    { type: "turn/end", data: {} },
  ];
  const { selected, frozen } = scanWorkbenchEvents(events);
  assert.equal(selected.benchId, "b2");
  assert.equal(frozen.name, "new");
});

test("scanWorkbenchEvents ignores unrelated events and an empty log", () => {
  assert.deepEqual(scanWorkbenchEvents([]), { selected: undefined, frozen: undefined });
  assert.deepEqual(scanWorkbenchEvents([{ type: "message", data: {} }]), {
    selected: undefined,
    frozen: undefined,
  });
});

test("the recorder writes the fields the scanner reads back", () => {
  const appended = [];
  const recorder = createSessionRecorder((session, type, data) => appended.push([session, type, data]));
  const session = { id: "s1" };

  recorder.selected(session, { benchId: "b1", name: "办公" });
  recorder.frozen(session, { benchId: "b1", name: "办公", core: ["read"], global: ["grep"], bench: ["pwsh"], allowed: ["read", "grep", "pwsh"] });

  assert.equal(appended[0][0], session);
  assert.equal(appended[0][1], SELECTED_EVENT);
  assert.equal(appended[0][2].name, "办公");
  assert.equal(typeof appended[0][2].at, "number");
  assert.equal(appended[1][1], FROZEN_EVENT);
  assert.deepEqual(appended[1][2].allowed, ["read", "grep", "pwsh"]);

  const { frozen } = scanWorkbenchEvents(appended.map(([, type, data]) => ({ type, data })));
  assert.deepEqual(frozen.core, ["read"]);
  assert.deepEqual(frozen.bench, ["pwsh"]);
});

test("the recorder copies arrays so later mutation cannot leak into the log", () => {
  const appended = [];
  const recorder = createSessionRecorder((_session, _type, data) => appended.push(data));
  const core = ["read"];
  recorder.frozen({ id: "s1" }, { core });
  core.push("write");
  assert.deepEqual(appended[0].core, ["read"]);
});

test("missing fields are normalised to null and empty lists", () => {
  const appended = [];
  const recorder = createSessionRecorder((_session, _type, data) => appended.push(data));
  recorder.selected({ id: "s1" }, {});
  recorder.frozen({ id: "s1" }, undefined);
  assert.equal(appended[0].benchId, null);
  assert.equal(appended[0].name, null);
  assert.deepEqual(appended[1].core, []);
  assert.deepEqual(appended[1].allowed, []);
});
