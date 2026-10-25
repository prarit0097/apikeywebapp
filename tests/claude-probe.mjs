// Installed-client protocol probe with a deterministic upstream, NOT a real LLM test.
import { createApp, finishApp } from "../dist/server/app.js";
import { mountGateway } from "../dist/server/gateway.js";
import { Store } from "../dist/server/store.js";
import { encryptSecret, digest } from "../dist/server/security.js";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

mkdirSync(".private/claude-probe", { recursive: true });
const fixture = resolve(".private/claude-probe/fixture.txt");
writeFileSync(fixture, "KEYPOOL_READ_FIXTURE");
const store = new Store(":memory:"),
  key = randomBytes(32),
  observed = [];
let upstreamCalls = 0;
store.saveGroup({ id: "mock", allowance: null, period: "daily" });
store.saveProvider({
  id: "mock",
  name: "Deterministic test upstream",
  adapter: "openai",
  baseUrl: "https://example.com/v1",
  encryptedKey: encryptSecret("fake-upstream-key", key),
  keySuffix: "-key",
  quotaGroup: "mock",
  models: ["fixture-model"],
  priority: 1,
  enabled: true,
  paid: false,
  allowPaid: false,
  tools: true,
  contextLimit: null,
  status: "untested",
  testedAt: null,
});
store.saveAlias({
  id: "coding",
  name: "coding",
  targets: [{ providerId: "mock", model: "fixture-model" }],
  allowCrossModel: false,
});
store.run(
  "INSERT INTO gateway_keys(id,name,hash,prefix,created) VALUES(?,?,?,?,?)",
  "probe",
  "probe",
  digest("kp_probe_only"),
  "kp_probe",
  Date.now(),
);
const app = createApp({
  store,
  origin: "http://localhost:4187",
  encryptionKey: key,
  bootstrapToken: randomBytes(32).toString("hex"),
  production: false,
  providerFetch: async (_url, options) => {
    upstreamCalls++;
    const request = JSON.parse(options.body);
    const toolResult = request.messages.some((m) => m.role === "tool");
    const tool = request.tools?.find((t) => t.function.name === "Read");
    const chunks =
      tool && !toolResult
        ? [
            {
              id: "probe",
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_probe",
                        function: {
                          name: "Read",
                          arguments: JSON.stringify({ file_path: fixture }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          ]
        : [
            { id: "probe", choices: [{ delta: { content: "KEYPOOL_OK" } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
          ];
    chunks.push({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    async function* body() {
      for (const chunk of chunks)
        yield Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`);
      yield Buffer.from("data: [DONE]\n\n");
    }
    return { statusCode: 200, headers: {}, body: body() };
  },
});
app.use((req, _res, next) => {
  if (req.path === "/v1/messages")
    observed.push({
      keys: Object.keys(req.body || {}),
      thinking: req.body.thinking,
      toolNames: req.body.tools?.map((t) => t.name),
      contentTypes: req.body.messages?.flatMap((m) =>
        Array.isArray(m.content) ? m.content.map((b) => b.type) : ["string"],
      ),
    });
  next();
});
mountGateway(app);
finishApp(app);
const server = app.listen(4187, "127.0.0.1");
const child = spawn(
  "C:/Users/hp/.local/bin/claude.exe",
  [
    "--bare",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--tools",
    "Read",
    "--allowedTools",
    "Read",
    "--permission-mode",
    "dontAsk",
    "--system-prompt",
    "Read the file when asked.",
    "--model",
    "coding",
    "--output-format",
    "json",
    "-p",
    `Read ${fixture} and then reply KEYPOOL_OK.`,
  ],
  {
    cwd: resolve(".private/claude-probe"),
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: resolve(".private/claude-probe/config"),
      ANTHROPIC_BASE_URL: "http://localhost:4187",
      ANTHROPIC_AUTH_TOKEN: "kp_probe_only",
      ANTHROPIC_MODEL: "coding",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "coding",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "coding",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "coding",
      MAX_THINKING_TOKENS: "0",
      DISABLE_PROMPT_CACHING: "1",
      ENABLE_TOOL_SEARCH: "false",
      CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  },
);
let stdout = "",
  stderr = "";
child.stdout.on("data", (b) => (stdout += b));
child.stderr.on("data", (b) => (stderr += b));
const timer = setTimeout(() => child.kill(), 90000);
const exit = await new Promise((resolve) => child.on("exit", resolve));
clearTimeout(timer);
server.close();
store.close();
writeFileSync(
  ".private/claude-probe-result.json",
  JSON.stringify({ exit, upstreamCalls, observed, stdout, stderr }, null, 2),
);
console.log(
  JSON.stringify({
    exit,
    upstreamCalls,
    observed,
    result: stdout.slice(-1500),
    stderr: stderr.slice(-400),
  }),
);
if (exit !== 0 || !stdout.includes("KEYPOOL_OK") || upstreamCalls < 2)
  process.exitCode = 1;
