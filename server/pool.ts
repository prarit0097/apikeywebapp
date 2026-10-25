import type { Store, Alias, Provider } from "./store.js";

export function eligibleProviders(store: Store): Provider[] {
  const groups = new Map(store.groups().map((g) => [g.id, g]));
  return store
    .providers()
    .filter(
      (p) =>
        p.enabled &&
        p.models.length > 0 &&
        (!p.paid ||
          (p.allowPaid && groups.get(p.quotaGroup)?.allowance != null)),
    );
}
export function superAlias(store: Store): Alias {
  return {
    id: "builtin-super",
    name: "super",
    allowCrossModel: true,
    targets: eligibleProviders(store)
      .sort((a, b) => a.priority - b.priority)
      .map((p) => ({ providerId: p.id, model: p.models[0] })),
  };
}
export function availableAliases(store: Store): Alias[] {
  const aliases = store.aliases();
  return aliases.some((a) => a.name === "super")
    ? aliases
    : [superAlias(store), ...aliases];
}
export function poolSummary(store: Store, keyId?: string) {
  const aliases = availableAliases(store),
    route = aliases.find((a) => a.name === "super")!;
  const eligible = eligibleProviders(store);
  const ids = new Set(route.targets.map((t) => t.providerId));
  const providers = eligible.filter((p) => ids.has(p.id));
  const groupIds = new Set(providers.map((p) => p.quotaGroup));
  const groups = store.groups().filter((g) => groupIds.has(g.id));
  const buckets = new Map<string, typeof groups>();
  for (const g of groups) {
    const k =
      g.period === "lifetime" ? "lifetime" : `${g.period}:${g.timezone}`;
    buckets.set(k, [...(buckets.get(k) || []), g]);
  }
  const periods = [...buckets.entries()].map(([id, items]) => {
    const known = items.filter((g) => g.allowance !== null);
    const unknownPools = items.length - known.length;
    const knownTotal = known.reduce((n, g) => n + g.allowance!, 0);
    return {
      id,
      period: items[0].period,
      timezone: items[0].period === "lifetime" ? null : items[0].timezone,
      poolCount: items.length,
      unknownPools,
      totalQuota: unknownPools ? null : knownTotal,
      knownTotal,
      usedQuota: items.reduce((n, g) => n + g.consumed, 0),
      reservedQuota: items.reduce((n, g) => n + g.reserved, 0),
      balanceQuota: unknownPools
        ? null
        : known.reduce(
            (n, g) => n + Math.max(0, g.allowance! - g.consumed - g.reserved),
            0,
          ),
      knownBalance: known.reduce(
        (n, g) => n + Math.max(0, g.allowance! - g.consumed - g.reserved),
        0,
      ),
      nextResetAt: items[0].resetAt,
    };
  });
  const compatible = periods.length <= 1;
  const unknownPools = groups.filter((g) => g.allowance === null).length;
  const complete = compatible && unknownPools === 0;
  const key = keyId
    ? store.get("SELECT * FROM key_usage WHERE key_id=?", keyId)
    : undefined;
  const migration = store.get(
    "SELECT applied FROM migrations WHERE id='key-usage-v1'",
  );
  return {
    model: "super",
    estimated: true,
    source: "owner-entered allowances; gateway-reported usage",
    usageScope:
      "all clients using this gateway; direct provider usage is not tracked",
    sharedPool: true,
    providerCount: providers.length,
    poolCount: groups.length,
    unknownPools,
    mixedSchedules: !compatible,
    complete,
    totalQuota: complete
      ? periods.reduce((n, p) => n + (p.totalQuota || 0), 0)
      : null,
    knownTotal: periods.reduce((n, p) => n + p.knownTotal, 0),
    usedQuota: periods.reduce((n, p) => n + p.usedQuota, 0),
    reservedQuota: periods.reduce((n, p) => n + p.reservedQuota, 0),
    balanceQuota: complete
      ? periods.reduce((n, p) => n + (p.balanceQuota || 0), 0)
      : null,
    knownBalance: periods.reduce((n, p) => n + p.knownBalance, 0),
    coolingPools: groups.filter((g) => g.cooldownUntil > Date.now()).length,
    periods,
    ...(keyId
      ? {
          keyUsedQuota: key?.unknown_requests ? null : key?.tokens || 0,
          keyKnownUsed: key?.tokens || 0,
          keyUnknownRequests: key?.unknown_requests || 0,
          keyUsageSince: key?.since || migration?.applied || Date.now(),
        }
      : {}),
    updatedAt: Date.now(),
  };
}
export type PoolSummary = ReturnType<typeof poolSummary>;
