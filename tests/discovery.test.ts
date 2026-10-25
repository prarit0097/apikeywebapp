import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp, finishApp } from "../server/app.js";
import { mountGateway } from "../server/gateway.js";
import { discoverProvider, normalizeBaseUrl } from "../server/discovery.js";

const json = (value: any, statusCode = 200) => ({
  statusCode,
  headers: {},
  body: (async function* () {
    yield Buffer.from(JSON.stringify(value));
  })(),
});
const config = (providerFetch: any) => ({
  store: new Store(":memory:"),
  origin: "http://localhost:4000",
  encryptionKey: randomBytes(32),
  bootstrapToken: "discovery-test-bootstrap-token-123",
  production: false,
  providerFetch,
});
test("base URL normalization removes generation suffixes and detects known provider formats", () => {
  assert.equal(
    normalizeBaseUrl("https://router.bynara.id/v1/chat/completions").baseUrl,
    "https://router.bynara.id/v1",
  );
  assert.equal(
    normalizeBaseUrl("https://api.anthropic.com").adapter,
    "anthropic",
  );
  assert.equal(
    normalizeBaseUrl("https://generativelanguage.googleapis.com/v1beta")
      .baseUrl,
    "https://generativelanguage.googleapis.com/v1beta/openai",
  );
});
test("two values discover provider name, free models, context and tools without generation", async () => {
  const calls: any[] = [];
  const c = config(async (url: URL, options: any) => {
    calls.push({ url: String(url), method: options.method });
    return url.pathname.endsWith("/models")
      ? json({
          data: [
            {
              id: "image-only",
              type: "image",
              pricing: { prompt: "0", completion: "0" },
            },
            {
              id: "paid-chat",
              pricing: { prompt: "0.01", completion: "0.02" },
            },
            {
              id: "free-coder",
              context_length: 32000,
              supported_parameters: ["tools"],
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        })
      : json({}, 404);
  });
  const result = await discoverProvider(c, {
    baseUrl: "https://router.bynara.id/v1",
    apiKey: "fixture-provider-key",
  });
  assert.equal(result.provider.name, "NaraRouter");
  assert.deepEqual(result.provider.models, ["free-coder"]);
  assert.equal(result.provider.tools, true);
  assert.equal(result.provider.contextLimit, 32000);
  assert.equal(result.provider.paid, false);
  assert.equal(result.provider.enabled, true);
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.ok(
    calls.every((c) => new URL(c.url).origin === "https://router.bynara.id"),
  );
  assert.ok(!JSON.stringify(result).includes("fixture-provider-key"));
  c.store.close();
});
test("missing, null or malformed prices never become free or unlimited tokens", async () => {
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          data: [
            { id: "unknown-chat", pricing: { prompt: null, completion: null } },
            { id: "fake-free", pricing: { prompt: "", completion: "" } },
          ],
        })
      : json({ balance: 50, currency: "USD" }, 200),
  );
  const result = await discoverProvider(c, {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-key-unknown",
  });
  assert.equal(result.provider.paid, true);
  assert.equal(result.provider.allowPaid, false);
  assert.equal(result.provider.enabled, false);
  assert.equal(result.tokenQuota, null);
  assert.equal(result.provider.status, "billing_unverified");
  c.store.close();
});
test("discovery cannot leak a saved credential by changing its origin without re-entry", async () => {
  let calls = 0;
  const c = config(async () => {
    calls++;
    return json({ data: [] });
  });
  const previous: any = {
    id: "p",
    baseUrl: "https://first.example/v1",
    encryptedKey: "opaque",
    quotaGroup: "old",
  };
  await assert.rejects(
    discoverProvider(c, { baseUrl: "https://second.example/v1" }, previous),
    /re-enter|new origin/i,
  );
  assert.equal(calls, 0);
  c.store.close();
});
test("private endpoints are rejected before any authenticated probe", async () => {
  let calls = 0;
  const c = config(async () => {
    calls++;
    return json({});
  });
  await assert.rejects(
    discoverProvider(c, {
      baseUrl: "https://127.0.0.1/v1",
      apiKey: "fixture-provider-key",
    }),
  );
  assert.equal(calls, 0);
  c.store.close();
});
test("missing models save a pending detection result instead of invented model IDs", async () => {
  const c = config(async () => json({}, 404));
  const result = await discoverProvider(c, {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-provider-key",
  });
  assert.deepEqual(result.provider.models, []);
  assert.equal(result.provider.enabled, false);
  assert.equal(result.provider.status, "discovery_pending");
  c.store.close();
});
test("keys with unknown account identity conservatively share an upstream pool", async () => {
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          data: [{ id: "free-chat", pricing: { prompt: 0, completion: 0 } }],
        })
      : json({}, 404),
  );
  const a = await discoverProvider(c, {
      baseUrl: "https://example.com/v1",
      apiKey: "fixture-key-one",
    }),
    b = await discoverProvider(c, {
      baseUrl: "https://example.com/v2",
      apiKey: "fixture-key-two",
    });
  assert.equal(a.provider.quotaGroup, b.provider.quotaGroup);
  assert.equal(a.provider.discovery?.groupVerified, false);
  c.store.close();
});
test("owner connection endpoint accepts only URL and key, encrypts them and initializes discovered models", async () => {
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          data: [
            {
              id: "free-coder",
              pricing: { prompt: 0, completion: 0 },
              supported_parameters: ["tools"],
            },
          ],
        })
      : json({}, 404),
  );
  const app = createApp(c);
  mountGateway(app);
  finishApp(app);
  const agent = request.agent(app);
  const s = await agent.post("/api/setup").set("Origin", c.origin).send({
    token: c.bootstrapToken,
    email: "owner@example.com",
    password: "strong-password-123",
  });
  const r = await agent
    .post("/api/admin/providers/connect")
    .set("Origin", c.origin)
    .set("X-CSRF-Token", s.body.csrf)
    .send({
      baseUrl: "https://router.bynara.id/v1",
      apiKey: "fixture-private-api-key",
    });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.provider.name, "NaraRouter");
  assert.ok(!r.text.includes("fixture-private-api-key"));
  assert.ok(!r.text.includes("encryptedKey"));
  assert.equal(c.store.providers().length, 1);
  assert.deepEqual(c.store.providers()[0].models, ["free-coder"]);
  c.store.close();
});

test("provider-reported token balance imports an external-usage offset without resetting gateway usage", async () => {
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          data: [{ id: "free-coder", pricing: { prompt: 0, completion: 0 } }],
        })
      : url.pathname.endsWith("/quota")
        ? json({
            quota: {
              unit: "tokens",
              total: 1000,
              remaining: 750,
              period: "lifetime",
            },
          })
        : json({}, 404),
  );
  const app = createApp(c);
  mountGateway(app);
  finishApp(app);
  const agent = request.agent(app);
  const s = await agent.post("/api/setup").set("Origin", c.origin).send({
    token: c.bootstrapToken,
    email: "owner@example.com",
    password: "strong-password-123",
  });
  const connect = () =>
    agent
      .post("/api/admin/providers/connect")
      .set("Origin", c.origin)
      .set("X-CSRF-Token", s.body.csrf)
      .send({
        baseUrl: "https://example.com/v1",
        apiKey: "fixture-private-key",
      });
  assert.equal((await connect()).status, 201);
  let overview = await agent.get("/api/admin/overview");
  assert.equal(overview.body.superQuota.totalQuota, 1000);
  assert.equal(overview.body.superQuota.balanceQuota, 750);
  const g = c.store.groups()[0];
  const reservation = c.store.reserve(g.id, 10)!;
  c.store.settle(reservation, 10);
  assert.equal((await connect()).status, 201);
  overview = await agent.get("/api/admin/overview");
  assert.equal(overview.body.superQuota.usedQuota, 10);
  assert.equal(overview.body.superQuota.balanceQuota, 740);
  c.store.close();
});

test("explicit positive prices override contradictory free flags", async () => {
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          data: [
            {
              id: "paid",
              free: true,
              is_free: true,
              pricing: { prompt: "0.01", completion: "0.02" },
            },
          ],
        })
      : json({}, 404),
  );
  const r = await discoverProvider(c, {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-private-key",
  });
  assert.equal(r.provider.enabled, false);
  assert.equal(r.provider.paid, true);
  c.store.close();
});
test("mixed account identity visibility cannot split the same upstream into additional capacity", async () => {
  let identity = true;
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          ...(identity ? { account_id: "account-a" } : {}),
          data: [{ id: "free", pricing: { prompt: 0, completion: 0 } }],
        })
      : json({}, 404),
  );
  const a = await discoverProvider(c, {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-private-key-one",
  });
  identity = false;
  const b = await discoverProvider(c, {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-private-key-two",
  });
  assert.equal(a.provider.quotaGroup, b.provider.quotaGroup);
  c.store.close();
});
test("malformed optional capability fields do not abort otherwise valid discovery", async () => {
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({
          data: [
            {
              id: "free",
              architecture: { output_modalities: "text" },
              pricing: { prompt: 0, completion: 0 },
            },
          ],
        })
      : json({}, 404),
  );
  const r = await discoverProvider(c, {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-private-key",
  });
  assert.deepEqual(r.provider.models, ["free"]);
  c.store.close();
});
test("rediscovery can populate an initially unknown auto quota without replacing a manual budget", async () => {
  let exposesQuota = false;
  const c = config(async (url: URL) =>
    url.pathname.endsWith("/models")
      ? json({ data: [{ id: "free", pricing: { prompt: 0, completion: 0 } }] })
      : url.pathname.endsWith("/quota") && exposesQuota
        ? json({
            quota: {
              unit: "tokens",
              total: 1000,
              remaining: 750,
              period: "lifetime",
            },
          })
        : json({}, 404),
  );
  const app = createApp(c);
  mountGateway(app);
  finishApp(app);
  const agent = request.agent(app);
  const login = await agent.post("/api/setup").set("Origin", c.origin).send({
    token: c.bootstrapToken,
    email: "owner@example.com",
    password: "strong-password-123",
  });
  const mutation = (path: string, body: any) =>
    agent
      .post(path)
      .set("Origin", c.origin)
      .set("X-CSRF-Token", login.body.csrf)
      .send(body);
  const created = await mutation("/api/admin/providers/connect", {
    baseUrl: "https://example.com/v1",
    apiKey: "fixture-private-key",
  });
  assert.equal(created.status, 201);
  exposesQuota = true;
  const rediscovered = await mutation(
    `/api/admin/providers/${created.body.provider.id}/rediscover`,
    {},
  );
  assert.equal(rediscovered.status, 200);
  assert.equal(c.store.groups()[0].allowance, 1000);
  assert.equal(c.store.groups()[0].externalUsed, 250);
  c.store.close();
});

test("an in-flight rediscovery cannot undo a concurrent owner pause", async () => {
  let block = false,
    started!: () => void,
    release!: () => void;
  const begun = new Promise<void>((r) => (started = r)),
    waiting = new Promise<void>((r) => (release = r));
  const c = config(async (url: URL) => {
    if (block && url.pathname.endsWith("/models")) {
      started();
      await waiting;
    }
    return url.pathname.endsWith("/models")
      ? json({ data: [{ id: "free", pricing: { prompt: 0, completion: 0 } }] })
      : json({}, 404);
  });
  const app = createApp(c);
  mountGateway(app);
  finishApp(app);
  const agent = request.agent(app);
  const s = await agent
    .post("/api/setup")
    .set("Origin", c.origin)
    .send({
      token: c.bootstrapToken,
      email: "owner@example.com",
      password: "strong-password-123",
    });
  const created = await agent
    .post("/api/admin/providers/connect")
    .set("Origin", c.origin)
    .set("X-CSRF-Token", s.body.csrf)
    .send({ baseUrl: "https://example.com/v1", apiKey: "fixture-private-key" });
  const id = created.body.provider.id;
  block = true;
  const pending = agent
    .post(`/api/admin/providers/${id}/rediscover`)
    .set("Origin", c.origin)
    .set("X-CSRF-Token", s.body.csrf)
    .send({})
    .then((r) => r);
  await begun;
  const p = c.store.provider(id)!;
  c.store.saveProvider({ ...p, enabled: false });
  release();
  assert.equal((await pending).status, 409);
  assert.equal(c.store.provider(id)!.enabled, false);
  c.store.close();
});
