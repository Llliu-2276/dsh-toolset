import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal Anthropic-style Messages endpoint for the end-to-end check.
 *
 * The first reply calls `request_tool` for `MOCK_TOOL`; once a `tool_result`
 * comes back the second reply is a short final message (`MOCK_DONE`), which
 * lets the runner see the whole restriction → request → grant loop.
 */
const PORT = Number(process.env.MOCK_PORT || 8811);
const DIR = process.env.MOCK_DIR || join(process.cwd(), "requests");
const TOOL = process.env.MOCK_TOOL || "list_agents";
const DONE = process.env.MOCK_DONE || "E2E-DONE";

mkdirSync(DIR, { recursive: true });

let captured = 0;

function sse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const event of events) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

const textEvents = (text) => [
  { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
  { type: "message_stop" },
];

const toolUseEvents = (id, name, input) => [
  { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
];

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    captured += 1;
    const file = join(DIR, `req-${String(captured).padStart(3, "0")}.json`);
    writeFileSync(file, body);
    const second = body.includes("tool_result");
    console.log(`[mock] #${captured} ${req.method} ${req.url} ${body.length} bytes second=${second}`);
    if (second) {
      sse(res, textEvents(DONE));
      return;
    }
    sse(res, toolUseEvents("toolu_e2e_1", "request_tool", { tool: TOOL, reason: "the runner needs this tool" }));
  });
}).listen(PORT, "127.0.0.1", () => console.log(`[mock] listening on http://127.0.0.1:${PORT} (tool=${TOOL})`));
