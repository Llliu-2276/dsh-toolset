export const name = "e2e-approver";
export const inject = ["approval"];

/** Auto-answers approval requests with `allowed-once` so the run stays headless. */
export function apply(ctx) {
  ctx.on("approval/request", async (request) => {
    console.log(`[e2e-approver] ${request.toolName ?? request.callId ?? "?"} -> allowed-once`);
    return "allowed-once";
  });
}
