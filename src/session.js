import { FROZEN_EVENT, SELECTED_EVENT } from "./core.js";

/**
 * Scan a session log for the last selection and the last frozen snapshot.
 * Pure: works on any array of `{ type, data }` events.
 */
export function scanWorkbenchEvents(events) {
  let selected;
  let frozen;
  for (const event of events) {
    if (event.type === SELECTED_EVENT) selected = event.data;
    else if (event.type === FROZEN_EVENT) frozen = event.data;
  }
  return { selected, frozen };
}

/**
 * Bind the workbench record writers to DSH's plugin-record API.
 * @param append - `(session, type, data) => void`, normally `appendPluginRecord`.
 */
export function createSessionRecorder(append) {
  return {
    selected(session, data) {
      append(session, SELECTED_EVENT, {
        benchId: data?.benchId ?? null,
        name: data?.name ?? null,
        at: Date.now(),
      });
    },
    frozen(session, data) {
      append(session, FROZEN_EVENT, {
        benchId: data?.benchId ?? null,
        name: data?.name ?? null,
        core: [...(data?.core ?? [])],
        global: [...(data?.global ?? [])],
        bench: [...(data?.bench ?? [])],
        allowed: [...(data?.allowed ?? [])],
        at: Date.now(),
      });
    },
  };
}
