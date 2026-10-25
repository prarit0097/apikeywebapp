import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp, finishApp } from "../server/app.js";
import { Store } from "../server/store.js";
import express from "express";

test("Docker proxy client IPs isolate public authentication throttles", async () => {
  const store = new Store(":memory:");
  const app = finishApp(
    createApp({
      store,
      origin: "https://api.example.com",
      encryptionKey: randomBytes(32),
      bootstrapToken: "long-enough-bootstrap-token-123",
      production: true,
    }),
  );
  const proxy = express();
  proxy.use((req, _res, next) => {
    Object.defineProperty(req.socket, "remoteAddress", {
      value: "172.18.0.1",
      configurable: true,
    });
    next();
  });
  proxy.use(app);
  for (let i = 0; i < 26; i++)
    await request(proxy)
      .post("/api/login")
      .set("Origin", "https://api.example.com")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ email: "bad@example.com", password: "wrong" });
  const r = await request(proxy)
    .post("/api/login")
    .set("Origin", "https://api.example.com")
    .set("X-Forwarded-For", "203.0.113.11")
    .send({ email: "owner@example.com", password: "wrong" });
  assert.equal(r.status, 401);
  store.close();
});

const origin = "http://localhost:4000";
const setup = () => {
  const store = new Store(":memory:");
  return {
    store,
    app: finishApp(
      createApp({
        store,
        origin,
        encryptionKey: randomBytes(32),
        bootstrapToken: "bootstrap-test-token-long-enough",
        production: false,
      }),
    ),
  };
};
async function owner(app: any) {
  const agent = request.agent(app);
  const r = await agent.post("/api/setup").set("Origin", origin).send({
    token: "bootstrap-test-token-long-enough",
    email: "owner@example.com",
    password: "secure-password-123",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { agent, csrf: r.body.csrf };
}

test("setup requires the secret, closes after the first owner, and private APIs are protected", async () => {
  const { app, store } = setup();
  assert.equal((await request(app).get("/api/admin/overview")).status, 401);
  assert.equal(
    (
      await request(app)
        .post("/api/setup")
        .set("Origin", origin)
        .send({ token: "wrong", email: "a@b.com", password: "password-long" })
    ).status,
    403,
  );
  const { agent } = await owner(app);
  assert.equal(
    (
      await agent.post("/api/setup").set("Origin", origin).send({
        token: "bootstrap-test-token-long-enough",
        email: "b@b.com",
        password: "password-long",
      })
    ).status,
    409,
  );
  assert.equal((await agent.get("/api/admin/overview")).status, 200);
  store.close();
});

test("simultaneous valid setup requests create exactly one owner", async () => {
  const { app, store } = setup();
  const payload = {
    token: "bootstrap-test-token-long-enough",
    email: "owner@example.com",
    password: "secure-password-123",
  };
  const replies = await Promise.all([
    request(app).post("/api/setup").set("Origin", origin).send(payload),
    request(app)
      .post("/api/setup")
      .set("Origin", origin)
      .send({ ...payload, email: "other@example.com" }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
  assert.equal(store.get("SELECT COUNT(*) n FROM owner").n, 1);
  store.close();
});

test("owner mutations require both exact Origin and CSRF token; provider responses hide secrets", async () => {
  const { app, store } = setup();
  const { agent, csrf } = await owner(app);
  const body = {
    name: "My provider",
    adapter: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-super-secret-provider",
    quotaGroup: "project-a",
    models: ["model-a"],
    priority: 10,
  };
  assert.equal(
    (await agent.post("/api/admin/providers").send(body)).status,
    403,
  );
  assert.equal(
    (
      await agent
        .post("/api/admin/providers")
        .set("Origin", "https://evil.example")
        .set("X-CSRF-Token", csrf)
        .send(body)
    ).status,
    403,
  );
  const r = await agent
    .post("/api/admin/providers")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = await agent.get("/api/admin/providers");
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.body).includes("sk-super-secret-provider"));
  assert.ok(!JSON.stringify(list.body).includes("encryptedKey"));
  store.close();
});

test("new credentials default to potentially paid instead of assuming free entitlement", async () => {
  const { app, store } = setup();
  const { agent, csrf } = await owner(app);
  const r = await agent
    .post("/api/admin/providers")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({
      name: "Unknown provider",
      adapter: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      quotaGroup: "unknown",
      models: ["model"],
    });
  assert.equal(r.status, 201);
  assert.equal(r.body.paid, true);
  assert.equal(r.body.allowPaid, false);
  store.close();
});

test("gateway key is revealed once, authenticated, revoked, and owner logout invalidates session", async () => {
  const { app, store } = setup();
  const { agent, csrf } = await owner(app);
  const r = await agent
    .post("/api/admin/keys")
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf)
    .send({ name: "Coding" });
  assert.equal(r.status, 201);
  assert.match(r.body.key, /^kp_/);
  const list = await agent.get("/api/admin/keys");
  assert.ok(!JSON.stringify(list.body).includes(r.body.key));
  assert.equal(
    (
      await request(app)
        .get("/v1/models")
        .set("Authorization", `Bearer ${r.body.key}`)
    ).status,
    200,
  );
  assert.equal(
    (
      await agent
        .delete(`/api/admin/keys/${r.body.id}`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .get("/v1/models")
        .set("Authorization", `Bearer ${r.body.key}`)
    ).status,
    401,
  );
  assert.equal(
    (
      await agent
        .post("/api/logout")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
    ).status,
    200,
  );
  assert.equal((await agent.get("/api/admin/overview")).status, 401);
  store.close();
});
