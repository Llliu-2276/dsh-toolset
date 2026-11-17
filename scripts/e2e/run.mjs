import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * End-to-end check: mount this plugin into a throwaway DSH profile, point the
 * model at a local mock, and assert what the harness actually sends.
 *
 * Nothing here touches the user's real profile: the run builds its own
 * DSH_HOME under the OS temp directory and removes it afterwards.
 *
 *   node scripts/e2e/run.mjs
 *
 * Environment:
 *   DSH_BIN   launcher path (default: the installed DeepSeek Harness CLI)
 *   E2E_PORT  mock port (default 8811)
 *   KEEP=1    keep the temporary DSH_HOME for inspection
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const DSH_BIN =
  process.env.DSH_BIN ||
  "D:\\Software\\Agent\\DeepseekHarness\\dsh\\resources\\runtime\\cli\\bin\\dsh.cmd";
const PORT = Number(process.env.E2E_PORT || 8811);

const BENCH = { id: "b_office", name: "办公", tools: ["read", "grep", "edit"], createdAt: 1 };
const GLOBAL_TOOLS = ["pwsh"];
const GRANT_TOOL = process.env.E2E_GRANT_TOOL || "list_agents";

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function write(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function requestSummary(body) {
  const tools = (body.tools ?? []).map((tool) => tool.name).sort();
  const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((part) => part.text ?? "").join("\n");
  return { tools, system, text: JSON.stringify(body.messages ?? []) };
}

if (!existsSync(DSH_BIN)) {
  console.error(`[e2e] launcher not found: ${DSH_BIN}\nSet DSH_BIN to a DeepSeek Harness launcher.`);
  process.exit(2);
}

const home = mkdtempSync(join(tmpdir(), "dsh-toolset-e2e-"));
const profile = join(home, "profiles", "headless");
const requests = join(home, "requests");
let mock;
let cleanup = false;

function stopMock() {
  if (mock && !mock.killed) mock.kill();
}

process.on("exit", () => {
  stopMock();
  if (!cleanup) return;
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // a lingering file handle on Windows only leaves temp litter
  }
});

try {
  mkdirSync(join(profile, "node_modules"), { recursive: true });
  write(
    join(profile, "package.json"),
    JSON.stringify(
      {
        name: "dsh-profile-headless-e2e",
        private: true,
        dependencies: { "dsh-toolset": `link:${repo.replaceAll("\\", "/")}` },
        dsh: {
          profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-toolset"] },
        },
      },
      null,
      2,
    ) + "\n",
  );
  write(join(profile, "cordis.yml"), "# empty root entry list\n[]\n");
  write(join(profile, "cordis.patch.yml"), "# user override layer\n[]\n");

  const linked = join(profile, "node_modules", "dsh-toolset");
  rmSync(linked, { recursive: true, force: true });
  symlinkSync(repo, linked, "junction");

  write(
    join(home, "plugin-data", "dsh-toolset", "workbenches.json"),
    JSON.stringify({ version: 1, lastSelected: BENCH.id, global: { tools: GLOBAL_TOOLS }, benches: [BENCH] }, null, 2) + "\n",
  );

  const overlay = join(home, "e2e.patch.yml");
  write(
    overlay,
    [
      "- id: agent-default-model",
      "  config:",
      "    provider: deepseek-official",
      "    model: deepseek-flash",
      "- insert:",
      "    - id: e2e-approver",
      `      name: '${pathToFileURL(join(here, "approver.js")).href}'`,
      "",
    ].join("\n"),
  );

  mock = spawn(process.execPath, [join(here, "mock-llm.mjs")], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_DIR: requests, MOCK_TOOL: GRANT_TOOL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let mockLog = "";
  mock.stdout.setEncoding("utf8");
  mock.stdout.on("data", (chunk) => {
    mockLog += chunk;
    process.stdout.write(chunk.split("\n").filter(Boolean).map((line) => `  ${line}\n`).join(""));
  });
  mock.stderr.setEncoding("utf8");
  mock.stderr.on("data", (chunk) => {
    mockLog += chunk;
  });
  for (let i = 0; i < 50 && !mockLog.includes("listening"); i += 1) await sleep(100);
  check("mock model is listening", mockLog.includes("listening"));

  const env = {
    ...process.env,
    DSH_HOME: home,
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${PORT}`,
    DEEPSEEK_API_KEY: "sk-e2e-placeholder",
  };
  const args = ["--profile", "headless", "--patch", overlay, "--approval-policy", "ask", "read the office files"];
  const started = Date.now();
  const child = spawn(DSH_BIN, args, { env, cwd: repo, shell: true });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((done) => {
    const timer = setTimeout(() => child.kill(), 180_000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      done(exitCode);
    });
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  check("headless run exits cleanly", code === 0, `exit=${code} in ${seconds}s`);
  check("model reached its final message", stdout.includes("E2E-DONE"));
  check("approval request was auto-approved", stdout.includes("[e2e-approver]"), stdout.match(/\[e2e-approver\][^\n]*/)?.[0] ?? "");

  const bodies = existsSync(requests)
    ? readdirSync(requests)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => requestSummary(JSON.parse(readFileSync(join(requests, name), "utf8"))))
    : [];
  check("the run produced model requests", bodies.length >= 2, `${bodies.length} request(s)`);

  const session = bodies.find((body) => body.tools.length > 0 && body.system.includes("## 其他已安装的工具"));
  const title = bodies.find((body) => body.tools.length === 0 && body.text.includes("Generate the session title"));
  const granted = bodies.find((body) => body.tools.includes(GRANT_TOOL));

  if (!session) {
    check("a conversation request carries a tool list", false);
  } else {
    const expected = ["read", "write", "grep", "pwsh", "request_tool"];
    check(
      "the restriction keeps the workbench, global and core tools",
      expected.every((name) => session.tools.includes(name)),
      session.tools.join(","),
    );
    check(
      "tools outside the workbench are withheld",
      !["web_search", "web_fetch", "subagent", "workflow", GRANT_TOOL].some((name) => session.tools.includes(name)),
    );
    check("the catalog reaches the system prompt", session.system.includes("## 其他已安装的工具"));
    check("the catalog names the current workbench", session.system.includes("当前工作台：「办公」"));
    check("the catalog labels unclassified tools", session.system.includes("（未分类）"));
    check("request_tool stays available inside the restriction", session.tools.includes("request_tool"));
  }

  check("the title agent stays unmasked", Boolean(title), title ? `${title.tools.length} tools` : "no title request seen");
  check(
    "an approved request adds the tool to the same turn",
    Boolean(granted),
    granted ? `${granted.tools.length} tools` : "no request after the grant",
  );
  check(
    "the harness announces the added tool",
    bodies.some((body) => body.text.includes("tool_addition")),
  );
  check(
    "no request was answered with a denial",
    !bodies.some((body) => body.text.includes("没有批准")),
  );

  if (process.env.KEEP === "1") {
    console.log(`\n[e2e] kept DSH_HOME at ${home}`);
  }
} finally {
  stopMock();
  if (process.env.KEEP !== "1") {
    await sleep(200);
    cleanup = true;
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      console.log(`[e2e] could not remove ${home}`);
    }
  }
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n[e2e] ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  console.error(`[e2e] failed: ${failed.map((entry) => entry.name).join(", ")}`);
  process.exit(1);
}
