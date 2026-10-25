import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { DateTime } from "luxon";
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("on-disk uncertain quota reservations survive a service restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "keypool-test-"));
  const filename = join(dir, "quota.sqlite");
  let s = new Store(filename);
  try {
    s.saveGroup({ id: "persistent", allowance: 100, period: "lifetime" });
    const id = s.reserve("persistent", 80)!;
    s.settle(id, null);
    s.close();
    s = new Store(filename);
    assert.equal(s.groups()[0].reserved, 80);
    assert.equal(s.reserve("persistent", 30), null);
  } finally {
    s.close();
    for (const file of readdirSync(dir)) unlinkSync(join(dir, file));
    rmdirSync(dir);
  }
});

test("shared quota reservations prevent parallel overspend and survive reconciliation", () => {
  const s = new Store(":memory:");
  s.saveGroup({ id: "shared", allowance: 100, period: "daily" });
  const a = s.reserve("shared", 70);
  assert.ok(a);
  assert.equal(s.reserve("shared", 40), null);
  s.settle(a!, 30);
  assert.ok(s.reserve("shared", 60));
  assert.equal(s.reserve("shared", 20), null);
  s.close();
});

test("unknown upstream usage keeps a conservative reservation instead of fabricating actual tokens", () => {
  const s = new Store(":memory:");
  s.saveGroup({ id: "shared", allowance: 100, period: "lifetime" });
  const a = s.reserve("shared", 80)!;
  s.settle(a, null);
  assert.equal(s.reserve("shared", 30), null);
  assert.equal(s.groups()[0].consumed, 0);
  assert.equal(s.groups()[0].reserved, 80);
  s.close();
});

test("quota group cooldown blocks every credential sharing that group", () => {
  const s = new Store(":memory:");
  s.saveGroup({ id: "shared", allowance: null, period: "daily" });
  s.cooldown("shared", Date.now() + 60000);
  assert.equal(s.reserve("shared", 10), null);
  assert.equal(s.groups().length, 1);
  s.close();
});

test("pool reset follows the provider timezone and untouched pools can change their period", () => {
  const s = new Store(":memory:");
  s.saveGroup({
    id: "pacific",
    allowance: 100,
    period: "daily",
    timezone: "America/Los_Angeles",
  });
  const g = s.groups()[0];
  assert.equal(
    DateTime.fromMillis(g.resetAt!).setZone("America/Los_Angeles").hour,
    0,
  );
  s.saveGroup({
    id: "pacific",
    allowance: 100,
    period: "monthly",
    timezone: "America/Los_Angeles",
  });
  assert.equal(s.groups()[0].period, "monthly");
  s.reserve("pacific", 10);
  assert.throws(
    () => s.saveGroup({ id: "pacific", allowance: 100, period: "daily" }),
    /usage|reservation/i,
  );
  s.close();
});

test("pool request and token per-minute limits apply across all credentials", () => {
  const s = new Store(":memory:");
  s.saveGroup({
    id: "limited",
    allowance: null,
    period: "daily",
    rpm: 1,
    tpm: 100,
  });
  assert.ok(s.reserve("limited", 50));
  assert.equal(s.reserve("limited", 1), null);
  s.saveGroup({ id: "tokens", allowance: null, period: "daily", tpm: 100 });
  assert.ok(s.reserve("tokens", 60));
  assert.equal(s.reserve("tokens", 50), null);
  s.close();
});
