import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp, finishApp } from "../server/app.js";
import { mountGateway } from "../server/gateway.js";
import { Store, type Provider } from "../server/store.js";
import { digest, encryptSecret } from "../server/security.js";

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
