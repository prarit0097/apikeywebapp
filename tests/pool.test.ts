import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, type Provider } from "../server/store.js";
import { poolSummary, superAlias, availableAliases } from "../server/pool.js";

function provider(id: string, group = id): Provider {
  return {
    id,
    name: id,
    quotaGroup: group,
    adapter: "openai",
    baseUrl: "https://example.com/v1",
    models: [`${id}-model`],
    encryptedKey: "opaque",
    keySuffix: "test",
    priority: 1,
    enabled: true,
    paid: false,
    allowPaid: false,
    tools: true,
    contextLimit: null,
    status: "untested",
    testedAt: null,
  };
}
test("super pool adds 10M + 3M + 3B once and subtracts used and reserved capacity", () => {
  const s = new Store(":memory:");
  for (const [id, n] of [
    ["a", 10000000],
    ["b", 3000000],
    ["c", 3000000000],
  ] as const) {
    s.saveGroup({ id, allowance: n, period: "lifetime" });
    s.saveProvider(provider(id));
  }
  const r = s.reserve("a", 100)!;
  s.settle(r, 40);
  s.reserve("b", 20);
  const q = poolSummary(s);
  assert.equal(q.totalQuota, 3013000000);
  assert.equal(q.usedQuota, 40);
  assert.equal(q.reservedQuota, 20);
  assert.equal(q.balanceQuota, 3012999940);
  assert.equal(q.estimated, true);
  s.close();
});
test("multiple keys sharing a project never multiply the allowance", () => {
  const s = new Store(":memory:");
  s.saveGroup({ id: "project", allowance: 100, period: "daily" });
  s.saveProvider(provider("a", "project"));
  s.saveProvider(provider("b", "project"));
  const q = poolSummary(s);
  assert.equal(q.totalQuota, 100);
  assert.equal(q.poolCount, 1);
  assert.equal(q.providerCount, 2);
  s.close();
});
test("unknown or incompatible reset periods do not manufacture an exact grand total", () => {
  const s = new Store(":memory:");
  s.saveGroup({ id: "a", allowance: 100, period: "daily" });
  s.saveProvider(provider("a"));
  s.saveGroup({ id: "b", allowance: null, period: "daily" });
  s.saveProvider(provider("b"));
  assert.equal(poolSummary(s).totalQuota, null);
  assert.equal(poolSummary(s).knownTotal, 100);
  s.saveGroup({ id: "b", allowance: 200, period: "lifetime" });
  assert.equal(poolSummary(s).totalQuota, null);
  assert.equal(poolSummary(s).periods.length, 2);
  s.close();
});
test("super route is automatic and paid or disabled keys do not inflate usable capacity", () => {
  const s = new Store(":memory:");
  for (const id of ["a", "b", "c"])
    s.saveGroup({ id, allowance: 100, period: "lifetime" });
  s.saveProvider(provider("a"));
  s.saveProvider({ ...provider("b"), enabled: false });
  s.saveProvider({ ...provider("c"), paid: true, allowPaid: false });
  assert.deepEqual(superAlias(s).targets, [
    { providerId: "a", model: "a-model" },
  ]);
  assert.equal(poolSummary(s).totalQuota, 100);
  assert.ok(availableAliases(s).some((a) => a.name === "super"));
  s.close();
});
test("per-super-key usage survives log pruning while shared balance includes all keys", () => {
  const s = new Store(":memory:");
  s.saveGroup({ id: "a", allowance: 1000, period: "lifetime" });
  s.saveProvider(provider("a"));
  for (const [id, n] of [
    ["one", 30],
    ["two", 20],
  ] as const) {
    const r = s.reserve("a", n)!;
    s.settle(r, n);
    s.log({
      id,
      alias: "super",
      provider: "a",
      keyId: id,
      success: true,
      input: n - 10,
      output: 10,
      latency: 1,
      error: null,
    });
  }
  s.run("DELETE FROM usage");
  const q = poolSummary(s, "one");
  assert.equal(q.keyUsedQuota, 30);
  assert.equal(q.usedQuota, 50);
  assert.equal(q.balanceQuota, 950);
  s.close();
});
