import {
  Database,
  ArrowRight,
  Clock3,
  Layers3,
  Zap,
  ShieldCheck,
} from "lucide-react";
import type { PoolSummary } from "../server/pool";
const compact = (n: number | null) =>
  n === null
    ? "Unknown"
    : new Intl.NumberFormat("en", {
        notation: n >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 3,
      }).format(n);
const exact = (n: number | null) =>
  n === null
    ? "Incomplete allowance"
    : `${new Intl.NumberFormat("en").format(n)} tokens`;
export default function SuperQuota({
  quota: q,
  onManage,
}: {
  quota: PoolSummary;
  onManage: () => void;
}) {
  const stats = [
    {
      label: "TOTAL SUPER QUOTA",
      value: q.totalQuota,
      detail: q.complete
        ? exact(q.totalQuota)
        : q.mixedSchedules
          ? "Separate reset schedules — see below"
          : `${compact(q.knownTotal)} known + ${q.unknownPools} unknown pools`,
      icon: Database,
    },
    {
      label: "USED VIA GATEWAY",
      value: q.usedQuota,
      detail: "Reported usage · all apps and shared keys",
      icon: Zap,
    },
    {
      label: "RESERVED / UNCERTAIN",
      value: q.reservedQuota,
      detail: "In-flight or unreported token usage",
      icon: Clock3,
    },
    {
      label: "BALANCE QUOTA",
      value: q.balanceQuota,
      detail: q.complete
        ? exact(q.balanceQuota)
        : "Estimate shown separately for each period",
      icon: ShieldCheck,
    },
  ];
  return (
    <section className="super-quota" aria-label="Super key quota">
      <div className="super-quota-heading">
        <div>
          <span className="live-dot" />
          <strong>SUPER KEY · SHARED TOKEN POOL</strong>
          <span className="badge amber">ESTIMATED</span>
        </div>
        <button className="text-button" onClick={onManage}>
          Manage pools <ArrowRight size={14} />
        </button>
      </div>
      <div className="super-quota-grid">
        {stats.map(({ label, value, detail, icon: Icon }) => (
          <div
            className={`super-quota-stat ${label === "BALANCE QUOTA" ? "balance" : ""}`}
            key={label}
          >
            <div>
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{compact(value)}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>
      {(!q.complete || q.periods.length > 1) &&
        q.periods.map((p) => (
          <div className="quota-period" key={p.id}>
            <span>
              <Layers3 size={14} />
              {p.period === "lifetime"
                ? "Fixed / lifetime"
                : `${p.period} · ${p.timezone}`}
              <small>
                {p.poolCount} pools
                {p.unknownPools ? ` · ${p.unknownPools} unknown` : ""}
              </small>
            </span>
            <span>
              Total <strong>{compact(p.totalQuota)}</strong>
            </span>
            <span>
              Used <strong>{compact(p.usedQuota)}</strong>
            </span>
            <span>
              Balance <strong>{compact(p.balanceQuota)}</strong>
            </span>
          </div>
        ))}
      <div className="super-quota-foot">
        <span>
          <Layers3 size={13} />
          {q.providerCount} eligible providers · {q.poolCount} independent quota
          pools{q.coolingPools ? ` · ${q.coolingPools} cooling down` : ""}
        </span>
        <span>
          <Clock3 size={12} />
          Refresh every 5s ·{" "}
          {new Date(q.updatedAt).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </div>
      <p className="super-quota-note">
        Allowances come from provider data or optional owner estimates. Balance
        subtracts gateway usage, reservations and imported prior provider usage
        ({compact(q.externalUsedQuota)} tokens). Provider usage may change
        between detections. Multiple super keys share this pool; their
        allowances do not multiply.
      </p>
    </section>
  );
}
