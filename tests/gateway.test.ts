import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp, finishApp } from "../server/app.js";
import { mountGateway } from "../server/gateway.js";
import { Store, type Provider } from "../server/store.js";
import { digest, encryptSecret } from "../server/security.js";

test("native upstream receives client version and beta headers unchanged", async () => {
  let headers: any;
  const { app, store, p } = setup(async (_url: any, options: any) => {
    headers = options.headers;
    async function* native() {
      for (const e of [
        {
          type: "message_start",
          message: {
            id: "native",
            role: "assistant",
            content: [],
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 0 },
        },
        { type: "message_stop" },
      ])
        yield Buffer.from(`data: ${JSON.stringify(e)}\n\n`);
    }
    return { statusCode: 200, headers: {}, body: native() };
  });
  store.saveProvider({ ...p, adapter: "anthropic" });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .set("anthropic-version", "2023-06-02")
    .set("anthropic-beta", "example-beta")
    .send(body);
  assert.equal(r.status, 200);
  assert.equal(headers["anthropic-version"], "2023-06-02");
  assert.equal(headers["anthropic-beta"], "example-beta");
  store.close();
});

function setup(providerFetch: any) {
  const store = new Store(":memory:"),
    encryptionKey = randomBytes(32);
  const config = {
    store,
    encryptionKey,
    origin: "http://localhost:4000",
    bootstrapToken: "long-test-bootstrap-token-123",
    production: false,
    providerFetch,
  };
  store.run(
    "INSERT INTO gateway_keys(id,name,hash,prefix,created) VALUES(?,?,?,?,?)",
    "k",
    "test",
    digest("kp_test"),
    "kp_test",
    Date.now(),
  );
  store.saveGroup({ id: "group", allowance: 100000, period: "daily" });
  const p: Provider = {
    id: "p",
    name: "Provider A",
    adapter: "openai",
    baseUrl: "https://example.com/v1",
    encryptedKey: encryptSecret("provider-secret", encryptionKey),
    keySuffix: "cret",
    quotaGroup: "group",
    models: ["model"],
    priority: 1,
    enabled: true,
    paid: false,
    allowPaid: false,
    tools: true,
    contextLimit: null,
    status: "untested",
    testedAt: null,
  };
  store.saveProvider(p);
  store.saveAlias({
    id: "a",
    name: "coding",
    targets: [{ providerId: "p", model: "model" }],
    allowCrossModel: false,
  });
  const app = createApp(config);
  mountGateway(app);
  finishApp(app);
  return { store, app, p };
}
function response(chunks: any[], status = 200, headers: any = {}) {
  async function* body() {
    for (const chunk of chunks)
      yield Buffer.from(
        `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`,
      );
  }
  return { statusCode: status, headers, body: body() };
}
const good = () =>
  response([
    { id: "chat1", choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    "[DONE]",
  ]);
const body = {
  model: "coding",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 32,
};

test("super alias automatically pools separate platforms without manually creating an alias", async () => {
  const { app, store, p } = setup(async () => good());
  store.run("DELETE FROM aliases");
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "super" });
  assert.equal(r.status, 200);
  assert.equal(r.body.model, "super");
  const q = await request(app).get("/v1/quota").set("X-Api-Key", "kp_test");
  assert.equal(q.status, 200);
  assert.equal(q.body.usedQuota, 15);
  assert.equal(q.body.keyUsedQuota, 15);
  assert.equal(q.body.balanceQuota, 99985);
  assert.ok(!JSON.stringify(q.body).includes("provider-secret"));
  store.close();
});

test("super routing reaches the fourth independent key after three rate-limited keys", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () =>
    ++calls <= 3 ? response([], 429, { "retry-after": "60" }) : good(),
  );
  for (let i = 1; i <= 3; i++) {
    store.saveGroup({ id: `g${i}`, allowance: 100000, period: "daily" });
    store.saveProvider({
      ...p,
      id: `p${i}`,
      quotaGroup: `g${i}`,
      priority: i + 1,
    });
  }
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "super" });
  assert.equal(r.status, 200);
  assert.equal(calls, 4);
  store.close();
});

test("explicit credit exhaustion switches to the next independent pool and does not leak upstream error text", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    if (calls > 1) return good();
    async function* errors() {
      yield Buffer.from(
        JSON.stringify({
          error: {
            code: "insufficient_quota",
            message: "secret-sensitive-provider-detail",
          },
        }),
      );
    }
    return { statusCode: 402, headers: {}, body: errors() };
  });
  store.saveGroup({ id: "other", allowance: 100000, period: "daily" });
  store.saveProvider({ ...p, id: "p2", quotaGroup: "other", priority: 2 });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "super" });
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  assert.ok(!r.text.includes("secret-sensitive"));
  assert.ok(
    store.groups().find((g) => g.id === "group")!.cooldownUntil > Date.now(),
  );
  store.close();
});

test("authenticated gateway translates actual upstream text, accounts usage and keeps secrets out of responses", async () => {
  const { app, store } = setup(async () => good());
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.content[0].text, "Hello");
  assert.equal(r.body.usage.input_tokens, 10);
  assert.equal(store.groups()[0].consumed, 15);
  assert.equal(store.groups()[0].reserved, 0);
  assert.equal(store.all("SELECT * FROM usage").length, 1);
  assert.ok(!r.text.includes("provider-secret"));
  store.close();
});
test("streaming sends ordered Anthropic events and the final stop", async () => {
  const { app, store } = setup(async () => good());
  const r = await request(app)
    .post("/v1/messages?beta=true")
    .set("Authorization", "Bearer kp_test")
    .send({ ...body, stream: true });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/event-stream/);
  assert.ok(r.text.indexOf("message_start") < r.text.indexOf("text_delta"));
  assert.ok(r.text.includes("message_stop"));
  assert.equal(store.groups()[0].consumed, 15);
  store.close();
});

test("interrupted response emits a stream error without claiming completion or replaying", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    return response([{ choices: [{ delta: { content: "partial" } }] }]);
  });
  store.saveProvider({ ...p, id: "p2" });
  store.saveAlias({
    id: "a",
    name: "coding",
    targets: [
      { providerId: "p", model: "model" },
      { providerId: "p2", model: "model" },
    ],
    allowCrossModel: false,
  });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, stream: true });
  assert.equal(r.status, 200);
  assert.match(r.text, /event: error/);
  assert.ok(!r.text.includes("event: message_stop"));
  assert.equal(calls, 1);
  assert.ok(store.groups()[0].reserved > 0);
  store.close();
});

test("client cancellation aborts the upstream and retains its uncertain reservation", async () => {
  let cancelled!: () => void;
  const aborted = new Promise<void>((r) => (cancelled = r));
  let calls = 0;
  const { app, store } = setup(async (_url: any, options: any) => {
    calls++;
    async function* stream() {
      yield Buffer.from(
        'data: {"choices":[{"delta":{"content":"start"}}]}\n\n',
      );
      await new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => {
            cancelled();
            reject(new Error("aborted"));
          },
          { once: true },
        ),
      );
    }
    return { statusCode: 200, headers: {}, body: stream() };
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const ctl = new AbortController();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": "kp_test" },
      body: JSON.stringify({ ...body, stream: true }),
      signal: ctl.signal,
    });
    await r.body!.getReader().read();
    ctl.abort();
    await Promise.race([
      aborted,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("upstream not cancelled")), 1500),
      ),
    ]);
    assert.equal(calls, 1);
    assert.ok(store.groups()[0].reserved > 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});
test("rate limit cools down a shared group and falls back only to independent capacity", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () =>
    ++calls === 1 ? response([], 429, { "retry-after": "60" }) : good(),
  );
  store.saveProvider({ ...p, id: "p2", name: "B" });
  store.saveGroup({ id: "independent", allowance: null, period: "daily" });
  store.saveProvider({ ...p, id: "p3", name: "C", quotaGroup: "independent" });
  store.saveAlias({
    id: "a",
    name: "coding",
    targets: [
      { providerId: "p", model: "model" },
      { providerId: "p2", model: "model" },
      { providerId: "p3", model: "model" },
    ],
    allowCrossModel: false,
  });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  assert.ok(
    store.groups().find((g) => g.id === "group")!.cooldownUntil > Date.now(),
  );
  store.close();
});
test("ambiguous network failure never retries another key and keeps its reservation", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    throw new Error("socket failed with provider-secret");
  });
  store.saveProvider({ ...p, id: "p2" });
  store.saveAlias({
    id: "a",
    name: "coding",
    targets: [
      { providerId: "p", model: "model" },
      { providerId: "p2", model: "model" },
    ],
    allowCrossModel: false,
  });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(r.status, 502);
  assert.equal(calls, 1);
  assert.ok(!r.text.includes("provider-secret"));
  assert.ok(store.groups()[0].reserved > 0);
  store.close();
});
test("paid or tool-incompatible providers are not silently selected", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    return good();
  });
  store.saveProvider({ ...p, paid: true, allowPaid: false });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(r.status, 503);
  assert.equal(calls, 0);
  store.close();
});

test("paid opt-in still requires a known local token budget before dispatch", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    return good();
  });
  store.saveGroup({ id: "group", allowance: null, period: "daily" });
  store.saveProvider({ ...p, paid: true, allowPaid: true });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(r.status, 503);
  assert.equal(calls, 0);
  store.close();
});

test("an in-flight credential rejection cannot disable a rotated replacement key", async () => {
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>((r) => (started = r)),
    waiting = new Promise<void>((r) => (release = r));
  const { app, store, p } = setup(async () => {
    started();
    await waiting;
    return response([], 401);
  });
  const pending = request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body)
    .then((r) => r);
  await begun;
  store.saveProvider({
    ...p,
    encryptedKey: "rotated-encrypted-key",
    enabled: true,
  });
  release();
  await pending;
  assert.equal(store.provider("p")!.encryptedKey, "rotated-encrypted-key");
  assert.equal(store.provider("p")!.enabled, true);
  store.close();
});

test("an in-flight provider test cannot restore an old key or overwrite current settings", async () => {
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>((r) => (started = r)),
    waiting = new Promise<void>((r) => (release = r));
  const { app, store, p } = setup(async () => {
    started();
    await waiting;
    async function* body() {
      yield Buffer.from('{"data":[]}');
    }
    return { statusCode: 200, headers: {}, body: body() };
  });
  const agent = request.agent(app);
  const setupResult = await agent
    .post("/api/setup")
    .set("Origin", "http://localhost:4000")
    .send({
      token: "long-test-bootstrap-token-123",
      email: "test@example.com",
      password: "long-password-123",
    });
  const pending = agent
    .post("/api/admin/providers/p/test")
    .set("Origin", "http://localhost:4000")
    .set("X-CSRF-Token", setupResult.body.csrf)
    .send({})
    .then((r) => r);
  await begun;
  store.saveProvider({
    ...p,
    encryptedKey: "new-secret-ciphertext",
    priority: 99,
    enabled: false,
  });
  release();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(store.provider("p")!.encryptedKey, "new-secret-ciphertext");
  assert.equal(store.provider("p")!.priority, 99);
  assert.equal(store.provider("p")!.enabled, false);
  store.close();
});

test("native Anthropic low-credit rejection fails over to an independent platform", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    if (calls > 1) return good();
    async function* errors() {
      yield Buffer.from(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            message: "Your credit balance is too low to access the API.",
          },
        }),
      );
    }
    return { statusCode: 400, headers: {}, body: errors() };
  });
  store.saveProvider({
    ...p,
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  });
  store.saveGroup({ id: "other", allowance: 100000, period: "daily" });
  store.saveProvider({ ...p, id: "p2", quotaGroup: "other", priority: 2 });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "super" });
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  store.close();
});

test("daily quota cooldown expires at reset instead of blocking replenished tokens for 24 hours", async (t) => {
  let calls = 0;
  const { app, store } = setup(async () => {
    calls++;
    if (calls > 1) return good();
    async function* errors() {
      yield Buffer.from('{"error":{"code":"daily_limit_exceeded"}}');
    }
    return { statusCode: 400, headers: {}, body: errors() };
  });
  const reset = store.groups()[0].resetAt!;
  t.mock.timers.enable({ apis: ["Date"], now: reset - 1000 });
  try {
    await request(app)
      .post("/v1/messages")
      .set("X-Api-Key", "kp_test")
      .send({ ...body, model: "super" });
    t.mock.timers.setTime(reset + 100);
    const r = await request(app)
      .post("/v1/messages")
      .set("X-Api-Key", "kp_test")
      .send({ ...body, model: "super" });
    assert.equal(r.status, 200);
    assert.equal(calls, 2);
  } finally {
    t.mock.timers.reset();
    store.close();
  }
});

test("recognized quota HTTP403 does not permanently disable a valid provider credential", async () => {
  const { app, store } = setup(async () => {
    async function* errors() {
      yield Buffer.from('{"error":{"code":"daily_limit_exceeded"}}');
    }
    return { statusCode: 403, headers: {}, body: errors() };
  });
  await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "super" });
  assert.equal(store.provider("p")!.enabled, true);
  assert.notEqual(store.provider("p")!.status, "credentials_rejected");
  store.close();
});

test("a stale custom alias cannot route a model removed by free-only discovery", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    return good();
  });
  store.saveProvider({ ...p, models: ["different-free-model"] });
  const r = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(r.status, 503);
  assert.equal(calls, 0);
  store.close();
});

test("discovered exact model IDs route without manual aliases and never substitute unknown Claude models", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    return good();
  });
  store.saveProvider({ ...p, models: ["claude-opus-5.5", "other-model"] });
  const exact = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "claude-opus-5.5" });
  assert.equal(exact.status, 200);
  const missing = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "claude-unavailable" });
  assert.equal(missing.status, 404);
  assert.match(missing.body.error.message, /model discovery/i);
  assert.match(missing.body.error.message, /super/);
  assert.equal(calls, 1);
  store.close();
});

test("model discovery supports Anthropic metadata, cursors and details while hiding ineligible providers", async () => {
  const { app, store, p } = setup(async () => good());
  store.saveProvider({ ...p, models: ["claude-opus-5.5", "other-model"] });
  store.saveProvider({
    ...p,
    id: "paused",
    enabled: false,
    models: ["hidden-paused"],
  });
  store.saveProvider({
    ...p,
    id: "paid",
    paid: true,
    allowPaid: false,
    models: ["hidden-paid"],
  });
  const list = await request(app)
    .get("/v1/models?limit=2")
    .set("X-Api-Key", "kp_test");
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);
  assert.equal(list.body.has_more, true);
  assert.equal(list.body.first_id, list.body.data[0].id);
  assert.equal(list.body.last_id, list.body.data[1].id);
  for (const m of list.body.data) {
    assert.equal(m.type, "model");
    assert.equal(m.object, "model");
    assert.equal(m.display_name, m.id);
    assert.ok(!Number.isNaN(Date.parse(m.created_at)));
  }
  const next = await request(app)
    .get(`/v1/models?limit=2&after_id=${encodeURIComponent(list.body.last_id)}`)
    .set("X-Api-Key", "kp_test");
  assert.equal(next.body.has_more, false);
  assert.deepEqual(
    next.body.data.map((m: any) => m.id),
    ["other-model"],
  );
  const detail = await request(app)
    .get("/v1/models/claude-opus-5.5")
    .set("X-Api-Key", "kp_test");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.id, "claude-opus-5.5");
  assert.equal(
    (
      await request(app)
        .get("/v1/models/hidden-paid")
        .set("X-Api-Key", "kp_test")
    ).status,
    404,
  );
  assert.equal(
    (await request(app).get("/v1/models?limit=0").set("X-Api-Key", "kp_test"))
      .status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .get("/v1/models?after_id=missing")
        .set("X-Api-Key", "kp_test")
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .get("/v1/models?after_id=super&before_id=super")
        .set("X-Api-Key", "kp_test")
    ).status,
    400,
  );
  const previous = await request(app)
    .get("/v1/models?before_id=other-model&limit=1")
    .set("X-Api-Key", "kp_test");
  assert.deepEqual(
    previous.body.data.map((m: any) => m.id),
    ["claude-opus-5.5"],
  );
  assert.equal(previous.body.has_more, true);
  assert.equal(
    (await request(app).get("/v1/models/claude-opus-5.5")).status,
    401,
  );
  store.close();
});

test("long discovered model IDs accepted by provider schema remain usable by clients", async () => {
  const { app, store, p } = setup(async () => good());
  const model = "provider/" + "m".repeat(130);
  store.saveProvider({ ...p, models: [model] });
  assert.equal(
    (
      await request(app)
        .get(`/v1/models/${encodeURIComponent(model)}`)
        .set("X-Api-Key", "kp_test")
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .post("/v1/messages")
        .set("X-Api-Key", "kp_test")
        .send({ ...body, model })
    ).status,
    200,
  );
  store.close();
});

test("explicit aliases override discovered model names and exact routes fail over only across the same model", async () => {
  let calls: string[] = [];
  const { app, store, p } = setup(async (url: any, options: any) => {
    const payload = JSON.parse(options.body);
    calls.push(payload.model);
    if (String(url).includes("example.com")) return response([], 429);
    return good();
  });
  store.saveProvider({ ...p, models: ["shared-model", "manual-model"] });
  store.saveProvider({
    ...p,
    id: "p2",
    quotaGroup: "group2",
    baseUrl: "https://second.example/v1",
    models: ["shared-model"],
  });
  store.saveGroup({ id: "group2", allowance: 100000, period: "daily" });
  const exact = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "shared-model" });
  assert.equal(exact.status, 200);
  assert.deepEqual(calls, ["shared-model", "shared-model"]);
  store.saveAlias({
    id: "manual",
    name: "shared-model",
    targets: [{ providerId: "p", model: "manual-model" }],
    allowCrossModel: false,
  });
  store.run("UPDATE quota_groups SET cooldown=0 WHERE id='group'");
  calls = [];
  const overridden = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send({ ...body, model: "shared-model" });
  assert.equal(overridden.status, 429);
  assert.deepEqual(calls, ["manual-model"]);
  store.close();
});

test("recognized maintenance is sanitized as retryable 503 without disabling credentials or spending quota", async () => {
  for (const error of [
    { code: "service_upgrading", type: "maintenance" },
    { code: "maintenance" },
    { type: "maintenance" },
  ]) {
    const { app, store } = setup(async () => ({
      statusCode: 503,
      headers: {},
      body: (async function* () {
        yield Buffer.from(
          JSON.stringify({
            error: { ...error, message: "provider-secret private detail" },
          }),
        );
      })(),
    }));
    const result = await request(app)
      .post("/v1/messages")
      .set("X-Api-Key", "kp_test")
      .send(body);
    assert.equal(result.status, 503);
    assert.equal(result.body.error.type, "overloaded_error");
    assert.match(result.body.error.message, /temporarily under maintenance/i);
    assert.ok(!result.text.includes("provider-secret"));
    assert.equal(store.provider("p")!.enabled, true);
    assert.equal(store.groups()[0].reserved, 0);
    assert.equal(store.groups()[0].consumed, 0);
    store.close();
  }
});

test("maintenance still fails over safely before streaming to another provider", async () => {
  let calls = 0;
  const { app, store, p } = setup(async () => {
    calls++;
    if (calls > 1) return good();
    return {
      statusCode: 503,
      headers: {},
      body: (async function* () {
        yield Buffer.from(
          JSON.stringify({ error: { code: "service_upgrading" } }),
        );
      })(),
    };
  });
  store.saveProvider({ ...p, id: "p2", quotaGroup: "group2" });
  store.saveGroup({ id: "group2", allowance: 100000, period: "daily" });
  store.saveAlias({
    id: "a",
    name: "coding",
    targets: [
      { providerId: "p", model: "model" },
      { providerId: "p2", model: "model" },
    ],
    allowCrossModel: false,
  });
  const result = await request(app)
    .post("/v1/messages")
    .set("X-Api-Key", "kp_test")
    .send(body);
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.equal(store.provider("p")!.enabled, true);
  assert.equal(store.groups().find((g) => g.id === "group")!.reserved, 0);
  assert.equal(store.groups().find((g) => g.id === "group")!.consumed, 0);
  store.close();
});

test("unrecognized failures never expose raw provider maintenance messages", async () => {
  for (const [status, error] of [
    [503, { code: "other", message: "maintenance provider-secret" }],
    [400, { code: "service_upgrading", type: "maintenance" }],
  ] as const) {
    const { app, store } = setup(async () => ({
      statusCode: status,
      headers: {},
      body: (async function* () {
        yield Buffer.from(JSON.stringify({ error }));
      })(),
    }));
    const result = await request(app)
      .post("/v1/messages")
      .set("X-Api-Key", "kp_test")
      .send(body);
    assert.equal(result.status, 502);
    assert.ok(!result.text.includes("provider-secret"));
    assert.ok(!result.text.includes("temporarily under maintenance"));
    store.close();
  }
});
