import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Database,
  ExternalLink,
  GitBranch,
  Globe,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
  AlertCircle,
  Eye,
  EyeOff,
  Power,
  Link2,
} from "lucide-react";
import type { PoolSummary } from "../server/pool";
import SuperQuota from "./SuperQuota";

type Provider = {
  id: string;
  name: string;
  adapter: string;
  baseUrl: string;
  quotaGroup: string;
  models: string[];
  priority: number;
  enabled: boolean;
  paid: boolean;
  allowPaid: boolean;
  tools: boolean;
  contextLimit: number | null;
  keySuffix: string;
  status: string;
  testedAt: number | null;
};
type Group = {
  id: string;
  allowance: number | null;
  period: string;
  consumed: number;
  reserved: number;
  resetAt: number | null;
  cooldownUntil: number;
  verified: boolean;
  timezone: string;
  rpm: number | null;
  tpm: number | null;
};
type Alias = {
  id: string;
  name: string;
  targets: { providerId: string; model: string }[];
  allowCrossModel: boolean;
};
type Key = {
  id: string;
  name: string;
  prefix: string;
  created: number;
  last_used: number | null;
  revoked: number;
  keyUsedQuota: number | null;
  keyKnownUsed: number;
  keyUnknownRequests: number;
  keyUsageSince: number;
};
type Usage = {
  id: string;
  created: number;
  alias: string;
  provider: string;
  success: number;
  input_tokens: number | null;
  output_tokens: number | null;
  latency: number;
  error: string | null;
};
type Session = {
  setupRequired: boolean;
  authenticated: boolean;
  email: string | null;
  csrf: string | null;
  origin: string;
};
type Overview = {
  superQuota: PoolSummary;
  stats: {
    requests: number;
    successes: number;
    inputTokens: number | null;
    outputTokens: number | null;
    latency: number | null;
  };
  providers: Provider[];
  groups: Group[];
  aliases: Alias[];
  keys: number;
  recent: Usage[];
  updatedAt: number;
};
type Page = "overview" | "providers" | "routing" | "keys" | "usage" | "connect";
const nav: { id: Page; name: string; icon: typeof Activity }[] = [
  { id: "overview", name: "Overview", icon: LayoutDashboard },
  { id: "providers", name: "Providers", icon: Layers3 },
  { id: "routing", name: "Model routing", icon: GitBranch },
  { id: "keys", name: "Gateway keys", icon: KeyRound },
  { id: "usage", name: "Request logs", icon: Activity },
  { id: "connect", name: "Connect Claude Code", icon: Terminal },
];
const number = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "Unknown"
    : Intl.NumberFormat("en", {
        notation: n >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 3,
      }).format(n);
const date = (n: number | null) =>
  n
    ? new Date(n).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";
const presets: Record<
  string,
  { adapter: string; baseUrl: string; models: string; group: string }
> = {
  custom: { adapter: "openai", baseUrl: "", models: "", group: "" },
  gemini: {
    adapter: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: "",
    group: "",
  },
  groq: {
    adapter: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: "",
    group: "",
  },
  openrouter: {
    adapter: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: "",
    group: "",
  },
  anthropic: {
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: "",
    group: "",
  },
  openai: {
    adapter: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: "",
    group: "",
  },
};
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <GitBranch size={23} strokeWidth={2.8} />
      </span>
      <span>
        keypool<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon = Layers3,
  title,
  children,
  action,
}: {
  icon?: typeof Activity;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const items = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ) || [],
      ).filter((x) => !x.hasAttribute("disabled"));
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = items(),
          first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
      >
        <div className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <button
      className="copy-button"
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setFailed(false);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setFailed(true);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      <span>{failed ? "Select & copy" : copied ? "Copied" : label}</span>
    </button>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [page, setPage] = useState<Page>(
      (location.hash.slice(1) as Page) || "overview",
    ),
    [data, setData] = useState<Overview | null>(null),
    [keys, setKeys] = useState<Key[]>([]),
    [usage, setUsage] = useState<Usage[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false);
  const [providerModal, setProviderModal] = useState<Provider | "new" | null>(
      null,
    ),
    [aliasModal, setAliasModal] = useState<Alias | "new" | null>(null),
    [groupModal, setGroupModal] = useState<Group | null>(null),
    [keyModal, setKeyModal] = useState(false),
    [revealed, setRevealed] = useState(""),
    [search, setSearch] = useState(""),
    [confirm, setConfirm] = useState<{
      title: string;
      body: string;
      action: () => Promise<void>;
    } | null>(null);
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };
  const api = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(session?.csrf ? { "X-CSRF-Token": session.csrf } : {}),
          ...options.headers,
        },
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 401 && url.startsWith("/api/admin"))
          setSession((s) => (s ? { ...s, authenticated: false } : s));
        throw new Error(body.error?.message || "Request failed");
      }
      return body;
    },
    [session?.csrf],
  );
  const refreshInFlight = useRef(false);
  const refresh = useCallback(
    async (quiet = false) => {
      if (!session?.authenticated) return;
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      if (!quiet) setLoading(true);
      try {
        const [overview, allKeys, logs] = await Promise.all([
          api("/api/admin/overview"),
          api("/api/admin/keys"),
          api("/api/admin/usage"),
        ]);
        setData(overview);
        setKeys(allKeys);
        setUsage(logs);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        refreshInFlight.current = false;
        setLoading(false);
      }
    },
    [session?.authenticated, api],
  );
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => {
        setError("Cannot reach the gateway. Refresh to try again.");
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!session?.authenticated) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const timer = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [session?.authenticated, refresh]);
  useEffect(() => {
    const change = () => {
      const p = location.hash.slice(1) as Page;
      setPage(nav.some((n) => n.id === p) ? p : "overview");
      setSearch("");
      setMobile(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const mutate = async (fn: () => Promise<any>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      notify(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const go = (p: Page) => {
    location.hash = p;
  };
  if (!session)
    return (
      <div className="boot">
        <Brand />
        {error ? <p role="alert">{error}</p> : <Loader2 className="spin" />}
      </div>
    );
  if (!session.authenticated)
    return (
      <Auth
        session={session}
        onLogin={async () => {
          const s = await fetch("/api/session").then((r) => r.json());
          setSession(s);
        }}
      />
    );
  const providers = data?.providers || [],
    aliases = data?.aliases || [],
    groups = data?.groups || [];
  const pageTitle = nav.find((n) => n.id === page)?.name || "Overview";
  const filteredProviders = providers.filter((p) =>
    `${p.name} ${p.adapter} ${p.quotaGroup}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const stats = data?.stats;
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand-link" href="#overview" aria-label="KeyPool home">
          <Brand />
        </a>
        <div className="workspace">
          <div className="workspace-icon">
            <Code2 size={17} />
          </div>
          <div>
            <strong>Personal workspace</strong>
            <span>Private gateway</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.slice(0, 5).map(({ id, name, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{name}</span>
              {id === "providers" && providers.length > 0 && (
                <small>{providers.length}</small>
              )}
              {page === id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="nav-label second">DEVELOPER</div>
        <nav>
          <a href="#connect" className={page === "connect" ? "active" : ""}>
            <Terminal size={18} />
            <span>Connect Claude Code</span>
            <ArrowUpRight size={13} />
          </a>
          <a
            href="https://github.com/prarit0097/apikeywebapp"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={18} />
            <span>Documentation</span>
            <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={19} />
            <div>
              <strong>Your keys, your control.</strong>
              <p>
                Encrypted at rest.
                <br />
                Never shared with clients.
              </p>
            </div>
          </div>
          <button
            className="account"
            onClick={() => {
              void api("/api/logout", { method: "POST", body: "{}" })
                .then(() =>
                  setSession({ ...session, authenticated: false, csrf: null }),
                )
                .catch((e) => setError(e.message));
            }}
          >
            <span className="avatar">
              {session.email?.slice(0, 1).toUpperCase() || "P"}
            </span>
            <span>
              <strong>Workspace owner</strong>
              <small>{session.email}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="private-pill">
              <span /> Private workspace
            </span>
            <a
              className="github-link"
              href="https://github.com/prarit0097/apikeywebapp"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <ArrowUpRight size={13} />
            </a>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR API WORKSPACE</div>
              <h1>
                {page === "overview" ? "One key. Every provider." : pageTitle}
              </h1>
              <p>
                {page === "overview"
                  ? "Bring your API keys together. Let your gateway handle the rest."
                  : page === "providers"
                    ? "Connect your providers. Keep every credential under your control."
                    : page === "routing"
                      ? "Give your models a single name and a clear fallback order."
                      : page === "keys"
                        ? "One gateway credential for your tools. Your provider keys stay private."
                        : page === "usage"
                          ? "A clear trail of requests, routes, and recorded token usage."
                          : "From your workspace to your terminal in a few steps."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="icon-button refresh"
                onClick={() => void refresh()}
                aria-label="Refresh workspace"
                disabled={loading}
              >
                <RefreshCw size={17} className={loading ? "spin" : ""} />
              </button>
              {page === "overview" || page === "providers" ? (
                <button
                  className="button primary"
                  onClick={() => setProviderModal("new")}
                >
                  <Plus size={17} />
                  Add provider
                </button>
              ) : page === "routing" ? (
                <button
                  className="button primary"
                  onClick={() => setAliasModal("new")}
                >
                  <Plus size={17} />
                  Create alias
                </button>
              ) : page === "keys" ? (
                <button
                  className="button primary"
                  onClick={() => setKeyModal(true)}
                >
                  <Plus size={17} />
                  Generate key
                </button>
              ) : null}
            </div>
          </div>
          {data?.superQuota && (
            <SuperQuota
              quota={data.superQuota}
              onManage={() => go("providers")}
            />
          )}
          {loading && !data ? (
            <div className="loading-panel">
              <Loader2 className="spin" />
              Loading your workspace…
            </div>
          ) : (
            <>
              {page === "overview" && (
                <>
                  <div className="stats-grid">
                    <Stat
                      label="ENABLED PROVIDERS"
                      value={String(providers.filter((p) => p.enabled).length)}
                      icon={Layers3}
                      detail={`${providers.length} total · ${groups.length} quota pools`}
                    />
                    <Stat
                      label="TOKENS ROUTED"
                      value={
                        stats?.inputTokens === null &&
                        stats?.outputTokens === null
                          ? "—"
                          : number(
                              (stats?.inputTokens || 0) +
                                (stats?.outputTokens || 0),
                            )
                      }
                      icon={Zap}
                      detail="Recorded input + output · last 24h"
                    />
                    <Stat
                      label="UPSTREAM SUCCESS"
                      value={
                        stats?.requests
                          ? `${Math.round((stats.successes / stats.requests) * 100)}%`
                          : "—"
                      }
                      icon={Activity}
                      detail={`${stats?.requests || 0} attempts · last 24h`}
                    />
                    <Stat
                      label="ACTIVE GATEWAY KEYS"
                      value={String(data?.keys || 0)}
                      icon={KeyRound}
                      detail={`${aliases.length} configured model aliases`}
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="panel gateway-panel">
                      <div className="panel-label">
                        <span>
                          <span className="live-dot" /> YOUR UNIFIED ENDPOINT
                        </span>
                        <Badge tone="green">PRIVATE GATEWAY</Badge>
                      </div>
                      <div className="gateway-title">
                        <div>
                          <h2>
                            Many providers.
                            <br />
                            <span>One connection.</span>
                          </h2>
                          <p>
                            A single endpoint for the models
                            <br className="desktop-break" /> and keys you
                            already have.
                          </p>
                        </div>
                        <div className="key-art" aria-hidden="true">
                          <div className="art-orbit one" />
                          <div className="art-orbit two" />
                          <div className="art-key">
                            <KeyRound size={45} strokeWidth={1.3} />
                          </div>
                          <span className="art-chip chip-one">
                            <Layers3 size={13} />
                          </span>
                          <span className="art-chip chip-two">
                            <Code2 size={13} />
                          </span>
                          <span className="art-chip chip-three">
                            <Zap size={13} />
                          </span>
                        </div>
                      </div>
                      <div className="endpoint-box">
                        <div>
                          <small>BASE URL</small>
                          <code>{session.origin}</code>
                        </div>
                        <CopyButton value={session.origin} label="Copy URL" />
                      </div>
                      <div className="gateway-footer">
                        <span>
                          <ShieldCheck size={14} /> Provider keys stay
                          server-side
                        </span>
                        <button
                          className="text-button"
                          onClick={() => go("connect")}
                        >
                          Connect your tools <ArrowRight size={15} />
                        </button>
                      </div>
                    </section>
                    <section className="panel start-panel">
                      <div className="section-heading">
                        <h2>Make your first connection</h2>
                        <Badge>
                          {
                            [
                              providers.length > 0,
                              aliases.length > 0,
                              (data?.keys || 0) > 0,
                            ].filter(Boolean).length
                          }
                          /3
                        </Badge>
                      </div>
                      <p className="muted small">
                        The super route automatically includes eligible
                        providers.
                      </p>
                      <div className="setup-steps">
                        {[
                          {
                            done: providers.length > 0,
                            title: "Connect a provider",
                            body: "Add your first API key securely.",
                            action: () => setProviderModal("new"),
                          },
                          {
                            done: aliases.length > 0,
                            title: "Choose your model routes",
                            body: "Map a model to a gateway alias.",
                            action: () => setAliasModal("new"),
                          },
                          {
                            done: (data?.keys || 0) > 0,
                            title: "Generate your gateway key",
                            body: "Use one credential in your tools.",
                            action: () => setKeyModal(true),
                          },
                        ].map((s, i) => (
                          <button
                            className={`setup-step ${s.done ? "done" : ""}`}
                            key={s.title}
                            onClick={s.action}
                          >
                            <span className="step-count">
                              {s.done ? (
                                <Check size={14} />
                              ) : (
                                String(i + 1).padStart(2, "0")
                              )}
                            </span>
                            <span>
                              <strong>{s.title}</strong>
                              <small>{s.body}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                      <div className="mini-callout">
                        <Terminal size={18} />
                        <span>Built for your coding workflow.</span>
                        <button
                          className="text-button"
                          onClick={() => go("connect")}
                        >
                          Setup <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>
                          Your providers{" "}
                          <span className="count">{providers.length}</span>
                        </h2>
                        <p>
                          Independent credentials. One place to manage them.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => go("providers")}
                      >
                        View all <ArrowRight size={15} />
                      </button>
                    </div>
                    {providers.length ? (
                      <ProviderTable
                        providers={providers.slice(0, 4)}
                        groups={groups}
                        onEdit={setProviderModal}
                        onQuota={setGroupModal}
                      />
                    ) : (
                      <Empty
                        title="Your first provider starts here"
                        action={
                          <button
                            className="button secondary"
                            onClick={() => setProviderModal("new")}
                          >
                            <Plus size={15} />
                            Connect a provider
                          </button>
                        }
                      >
                        Add a Gemini, Anthropic, or OpenAI-compatible key to
                        start routing.
                      </Empty>
                    )}
                  </section>
                  <div className="bottom-grid">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Recent activity</h2>
                        <button
                          className="text-button"
                          onClick={() => go("usage")}
                        >
                          Request logs <ArrowRight size={14} />
                        </button>
                      </div>
                      {data?.recent.length ? (
                        <UsageTable entries={data.recent.slice(0, 5)} compact />
                      ) : (
                        <div className="quiet-empty">
                          <Activity size={22} />
                          <p>No requests yet</p>
                          <small>
                            Your first request will appear here. No sample data.
                          </small>
                        </div>
                      )}
                    </section>
                    <section className="panel capacity-note">
                      <div className="note-icon">
                        <Database size={20} />
                      </div>
                      <h2>Capacity, without the guesswork.</h2>
                      <p>
                        Quotas stay with your providers. Keys in the same
                        account or project share a pool, so the same allowance
                        is never counted twice.
                      </p>
                      <div>
                        <Badge tone="amber">MANUAL / UNKNOWN</Badge>
                        <span>Balances are labelled by source.</span>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {page === "providers" && (
                <>
                  <div className="toolbar">
                    <div className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search providers"
                        placeholder="Search providers…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span className="muted small">
                      {providers.length} providers · {groups.length} quota pools
                    </span>
                  </div>
                  <section className="panel">
                    {filteredProviders.length ? (
                      <ProviderTable
                        providers={filteredProviders}
                        groups={groups}
                        onEdit={setProviderModal}
                        onQuota={setGroupModal}
                        onToggle={(p) =>
                          void mutate(
                            () =>
                              api(`/api/admin/providers/${p.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ enabled: !p.enabled }),
                              }),
                            p.enabled ? "Provider paused" : "Provider enabled",
                          ).catch(() => {})
                        }
                        onTest={(p) =>
                          mutate(async () => {
                            const r = await api(
                              `/api/admin/providers/${p.id}/test`,
                              { method: "POST", body: "{}" },
                            );
                            notify(r.message);
                          }, "Provider check completed").catch(() => {})
                        }
                        onDelete={(p) =>
                          setConfirm({
                            title: `Delete ${p.name}?`,
                            body: "This permanently removes the saved credential. Remove it from model routes first.",
                            action: async () => {
                              await mutate(
                                () =>
                                  api(`/api/admin/providers/${p.id}`, {
                                    method: "DELETE",
                                  }),
                                "Provider deleted",
                              );
                            },
                          })
                        }
                      />
                    ) : (
                      <Empty
                        title={
                          search
                            ? "No providers match"
                            : "Connect your first provider"
                        }
                        action={
                          !search && (
                            <button
                              className="button primary"
                              onClick={() => setProviderModal("new")}
                            >
                              <Plus size={16} />
                              Add provider
                            </button>
                          )
                        }
                      >
                        Your saved keys are encrypted. Only you can manage them.
                      </Empty>
                    )}
                  </section>
                  <div className="section-title">
                    <h2>Quota pools</h2>
                    <span className="muted small">
                      Reset schedules follow each pool timezone · allowances are
                      manual estimates
                    </span>
                  </div>
                  <div className="quota-grid">
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        className="panel quota-card"
                        onClick={() => setGroupModal(g)}
                      >
                        <div>
                          <Database size={18} />
                          <Settings2 size={15} />
                        </div>
                        <h3>{g.id}</h3>
                        <strong>
                          {g.allowance === null
                            ? "Unknown"
                            : number(
                                Math.max(
                                  0,
                                  g.allowance - g.consumed - g.reserved,
                                ),
                              )}
                          <small>
                            {g.allowance === null
                              ? "No balance supplied"
                              : `estimated remaining / ${g.period}`}
                          </small>
                        </strong>
                        <div className="quota-bar">
                          <span
                            style={{
                              width: `${g.allowance ? Math.min(100, ((g.consumed + g.reserved) / g.allowance) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <p>
                          {number(g.consumed)} recorded · {number(g.reserved)}{" "}
                          reserved
                        </p>
                        <Badge
                          tone={
                            g.cooldownUntil > Date.now() ? "amber" : "neutral"
                          }
                        >
                          {g.cooldownUntil > Date.now()
                            ? `Cooldown until ${date(g.cooldownUntil)}`
                            : g.allowance === null
                              ? "UNKNOWN"
                              : "MANUAL ESTIMATE"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {page === "routing" && (
                <>
                  {aliases.length ? (
                    <div className="routes-grid">
                      {aliases.map((a) => (
                        <section className="panel route-card" key={a.id}>
                          <div className="section-heading">
                            <div className="route-name">
                              <span className="provider-icon">
                                <GitBranch size={21} />
                              </span>
                              <div>
                                <h2>{a.name}</h2>
                                <span className="muted small">
                                  {a.targets.length} route
                                  {a.targets.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </div>
                            {a.id !== "builtin-super" && (
                              <button
                                className="icon-button"
                                aria-label={`Delete alias ${a.name}`}
                                onClick={() =>
                                  setConfirm({
                                    title: `Delete ${a.name}?`,
                                    body: "Clients using this alias will stop working until you create it again.",
                                    action: async () => {
                                      await mutate(
                                        () =>
                                          api(`/api/admin/aliases/${a.id}`, {
                                            method: "DELETE",
                                          }),
                                        "Alias deleted",
                                      );
                                    },
                                  })
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                          <div className="route-targets">
                            {a.targets.map((t, i) => (
                              <div key={i}>
                                <span className="target-order">{i + 1}</span>
                                <div>
                                  <strong>
                                    {providers.find(
                                      (p) => p.id === t.providerId,
                                    )?.name || "Missing provider"}
                                  </strong>
                                  <code>{t.model}</code>
                                </div>
                                <Badge>
                                  {i === 0 ? "PRIMARY" : "FALLBACK"}
                                </Badge>
                              </div>
                            ))}
                          </div>
                          <div className="route-footer">
                            <Badge tone={a.allowCrossModel ? "amber" : "green"}>
                              {a.id === "builtin-super"
                                ? "AUTOMATIC · ALL ELIGIBLE PROVIDERS"
                                : a.allowCrossModel
                                  ? "CROSS-MODEL OPT-IN"
                                  : "SAME-MODEL ROUTING"}
                            </Badge>
                            <button
                              className="text-button"
                              onClick={() =>
                                a.id === "builtin-super"
                                  ? go("providers")
                                  : setAliasModal(a)
                              }
                            >
                              {a.id === "builtin-super"
                                ? "Manage providers"
                                : "Edit route"}{" "}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <section className="panel">
                      <Empty
                        icon={GitBranch}
                        title="Give your model a familiar name"
                        action={
                          <button
                            className="button primary"
                            onClick={() => setAliasModal("new")}
                          >
                            <Plus size={16} />
                            Create your first alias
                          </button>
                        }
                      >
                        Create an alias like “coding”, choose a provider model,
                        and add compatible fallback routes.
                      </Empty>
                    </section>
                  )}
                  <div className="info-strip">
                    <ShieldCheck size={18} />
                    <span>
                      Fallback only uses configured, compatible capacity.
                      Partial streams and ambiguous network failures are never
                      replayed automatically.
                    </span>
                  </div>
                </>
              )}
              {page === "keys" && (
                <section className="panel">
                  {keys.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>KEY NAME</th>
                            <th>PREFIX</th>
                            <th>CREATED</th>
                            <th>LAST USED</th>
                            <th>USED BY THIS SUPER KEY</th>
                            <th>STATUS</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {keys.map((k) => (
                            <tr key={k.id}>
                              <td>
                                <div className="cell-name">
                                  <KeyRound size={17} />
                                  <strong>{k.name}</strong>
                                </div>
                              </td>
                              <td>
                                <code>{k.prefix}••••••</code>
                              </td>
                              <td>{date(k.created)}</td>
                              <td>{date(k.last_used)}</td>
                              <td>
                                <strong className="mono">
                                  {number(k.keyUsedQuota)}
                                </strong>
                                <small className="cell-sub">
                                  {k.keyUnknownRequests
                                    ? `${number(k.keyKnownUsed)} known + ${k.keyUnknownRequests} uncertain`
                                    : `Recorded since ${date(k.keyUsageSince)}`}
                                </small>
                              </td>
                              <td>
                                <Badge tone={k.revoked ? "neutral" : "green"}>
                                  {k.revoked ? "Revoked" : "Active"}
                                </Badge>
                              </td>
                              <td>
                                {!k.revoked && (
                                  <button
                                    className="button danger small-button"
                                    onClick={() =>
                                      setConfirm({
                                        title: `Revoke ${k.name}?`,
                                        body: "This immediately stops all clients using this gateway key. This cannot be undone.",
                                        action: async () => {
                                          await mutate(
                                            () =>
                                              api(`/api/admin/keys/${k.id}`, {
                                                method: "DELETE",
                                              }),
                                            "Key revoked",
                                          );
                                        },
                                      })
                                    }
                                  >
                                    Revoke
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={KeyRound}
                      title="One credential. All your routes."
                      action={
                        <button
                          className="button primary"
                          onClick={() => setKeyModal(true)}
                        >
                          <Plus size={16} />
                          Generate gateway key
                        </button>
                      }
                    >
                      Gateway keys are revealed once. Your original provider
                      keys never leave the server.
                    </Empty>
                  )}
                  <div className="panel-footnote">
                    <ShieldCheck size={15} /> Gateway keys are your super keys.
                    They share the pool above and provide access to your
                    configured routes. Keep them private and revoke unused keys.
                  </div>
                </section>
              )}
              {page === "usage" && (
                <>
                  <div className="toolbar">
                    <div className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search request logs"
                        placeholder="Filter by model, provider or error…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span className="muted small">
                      Latest 100 upstream attempts · 90-day retention
                    </span>
                  </div>
                  <section className="panel">
                    {usage.length ? (
                      <UsageTable
                        entries={usage.filter((u) =>
                          `${u.alias} ${u.provider} ${u.error || ""}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )}
                      />
                    ) : (
                      <Empty
                        icon={Activity}
                        title="Your request history will live here"
                      >
                        Send a request through your gateway to see its provider,
                        latency, outcome and recorded token usage.
                      </Empty>
                    )}
                  </section>
                  <div className="info-strip">
                    <ShieldCheck size={17} />
                    <span>
                      Prompts and responses are not logged. Unknown token usage
                      stays unknown; failed or interrupted requests may retain a
                      conservative quota reservation.
                    </span>
                  </div>
                </>
              )}
              {page === "connect" && (
                <Connect
                  origin={session.origin}
                  aliases={aliases}
                  providers={providers}
                  onCreateKey={() => setKeyModal(true)}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="live-dot" /> KeyPool · your private API gateway
            </span>
            <span>
              {data
                ? `Updated ${new Date(data.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
                : "Connecting…"}
              <span className="footer-separator">/</span>v1.0
            </span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {providerModal && (
        <ProviderForm
          provider={providerModal === "new" ? undefined : providerModal}
          onClose={() => setProviderModal(null)}
          onSave={async (body) => {
            await mutate(
              () =>
                api(
                  `/api/admin/providers${providerModal === "new" ? "" : `/${providerModal.id}`}`,
                  {
                    method: providerModal === "new" ? "POST" : "PUT",
                    body: JSON.stringify(body),
                  },
                ),
              "Provider saved",
            );
            setProviderModal(null);
          }}
        />
      )}
      {aliasModal && (
        <AliasForm
          alias={aliasModal === "new" ? undefined : aliasModal}
          providers={providers}
          onClose={() => setAliasModal(null)}
          onSave={async (body) => {
            await mutate(
              () =>
                api(
                  `/api/admin/aliases${aliasModal === "new" ? "" : `/${aliasModal.id}`}`,
                  {
                    method: aliasModal === "new" ? "POST" : "PUT",
                    body: JSON.stringify(body),
                  },
                ),
              "Model route saved",
            );
            setAliasModal(null);
          }}
        />
      )}
      {groupModal && (
        <QuotaForm
          group={groupModal}
          onClose={() => setGroupModal(null)}
          onSave={async (body) => {
            await mutate(
              () =>
                api(`/api/admin/groups/${encodeURIComponent(groupModal.id)}`, {
                  method: "PUT",
                  body: JSON.stringify(body),
                }),
              "Quota settings updated",
            );
            setGroupModal(null);
          }}
        />
      )}
      {keyModal && (
        <KeyForm
          revealed={revealed}
          onClose={() => {
            setKeyModal(false);
            setRevealed("");
          }}
          onSave={async (name) => {
            const r = await api("/api/admin/keys", {
              method: "POST",
              body: JSON.stringify({ name }),
            });
            setRevealed(r.key);
            await refresh();
          }}
        />
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="muted confirm-body">{confirm.body}</p>
          <div className="form-actions">
            <button
              className="button secondary"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void confirm
                  .action()
                  .then(() => setConfirm(null))
                  .catch(() => setConfirm(null))
              }
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Trash2 size={16} />
              )}
              Confirm
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  detail: string;
}) {
  return (
    <section className="stat-card">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function ProviderTable({
  providers,
  groups,
  onEdit,
  onQuota,
  onToggle,
  onTest,
  onDelete,
}: {
  providers: Provider[];
  groups: Group[];
  onEdit: (p: Provider) => void;
  onQuota: (g: Group) => void;
  onToggle?: (p: Provider) => void;
  onTest?: (p: Provider) => Promise<void>;
  onDelete?: (p: Provider) => void;
}) {
  const [testing, setTesting] = useState("");
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>PROVIDER</th>
            <th>STATUS</th>
            <th>QUOTA POOL</th>
            <th>CAPACITY</th>
            <th>MODELS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const g = groups.find((g) => g.id === p.quotaGroup);
            return (
              <tr key={p.id}>
                <td>
                  <button className="provider-name" onClick={() => onEdit(p)}>
                    <span className={`provider-icon ${p.adapter}`}>
                      <Layers3 size={19} />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.adapter === "gemini"
                          ? "Gemini"
                          : p.adapter === "anthropic"
                            ? "Anthropic"
                            : "OpenAI compatible"}{" "}
                        · ••••{p.keySuffix}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  <Badge
                    tone={
                      !p.enabled
                        ? "neutral"
                        : p.status === "connected"
                          ? "green"
                          : p.status.includes("failed") ||
                              p.status.includes("rejected")
                            ? "red"
                            : "amber"
                    }
                  >
                    <span className="status-dot" />
                    {!p.enabled
                      ? "Paused"
                      : p.status === "connected"
                        ? "Connected"
                        : p.status === "untested"
                          ? "Untested"
                          : "Check required"}
                  </Badge>
                  {p.paid && (
                    <div className="small muted">
                      Paid {p.allowPaid ? "opted in" : "blocked"}
                    </div>
                  )}
                </td>
                <td>
                  <button
                    className="text-button mono"
                    onClick={() => g && onQuota(g)}
                  >
                    {p.quotaGroup}
                    <Settings2 size={12} />
                  </button>
                </td>
                <td>
                  <strong className="capacity-value">
                    {g?.allowance === null || !g
                      ? "Unknown"
                      : number(
                          Math.max(0, g.allowance - g.consumed - g.reserved),
                        )}
                  </strong>
                  <small className="cell-sub">
                    {g?.allowance !== null && g
                      ? "manual estimate"
                      : "Not reported"}
                  </small>
                </td>
                <td>
                  <Badge>
                    {p.models.length} model{p.models.length !== 1 ? "s" : ""}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    {onTest && (
                      <button
                        className="icon-button"
                        title="Test credentials via model list"
                        aria-label={`Test ${p.name}`}
                        disabled={testing === p.id}
                        onClick={async () => {
                          setTesting(p.id);
                          try {
                            await onTest(p);
                          } finally {
                            setTesting("");
                          }
                        }}
                      >
                        {testing === p.id ? (
                          <Loader2 size={16} className="spin" />
                        ) : (
                          <Zap size={16} />
                        )}
                      </button>
                    )}
                    {onToggle && (
                      <button
                        className="icon-button"
                        title={p.enabled ? "Pause provider" : "Enable provider"}
                        aria-label={`${p.enabled ? "Pause" : "Enable"} ${p.name}`}
                        onClick={() => onToggle(p)}
                      >
                        <Power size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => onEdit(p)}
                    >
                      <Settings2 size={16} />
                    </button>
                    {onDelete && (
                      <button
                        className="icon-button"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => onDelete(p)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function UsageTable({
  entries,
  compact = false,
}: {
  entries: Usage[];
  compact?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>MODEL / PROVIDER</th>
            <th>STATUS</th>
            <th>TOKENS</th>
            {!compact && <th>LATENCY</th>}
            <th>TIME</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((u) => (
            <tr key={u.id}>
              <td>
                <strong className="mono">{u.alias}</strong>
                <small className="cell-sub">{u.provider}</small>
                {u.error && <small className="cell-error">{u.error}</small>}
              </td>
              <td>
                <Badge tone={u.success ? "green" : "red"}>
                  {u.success ? "Success" : "Failed"}
                </Badge>
              </td>
              <td className="mono">
                {u.input_tokens === null || u.output_tokens === null
                  ? "Unknown"
                  : number(u.input_tokens + u.output_tokens)}
              </td>
              {!compact && <td>{number(u.latency)} ms</td>}
              <td className="nowrap">{date(u.created)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Auth({
  session,
  onLogin,
}: {
  session: Session;
  onLogin: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch(
        session.setupRequired ? "/api/setup" : "/api/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: f.get("email"),
            password: f.get("password"),
            ...(session.setupRequired ? { token: f.get("token") } : {}),
          }),
        },
      );
      const r = await res.json();
      if (!res.ok) throw new Error(r.error?.message || "Sign in failed");
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="auth-story-center">
          <div className="eyebrow">LESS FRICTION. MORE BUILDING.</div>
          <h1>
            Your models.
            <br />
            Your keys.
            <br />
            <span>One gateway.</span>
          </h1>
          <p>
            A private home for your API providers.
            <br />
            Connect once. Keep building.
          </p>
          <div className="auth-diagram">
            <span>
              <Layers3 size={22} />
            </span>
            <i />
            <span className="auth-hub">
              <GitBranch size={30} />
            </span>
            <i />
            <span>
              <Terminal size={22} />
            </span>
          </div>
        </div>
        <span className="auth-foot">
          <ShieldCheck size={15} /> Encrypted credentials · Private workspace
        </span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form">
          <Badge tone="green">YOUR PRIVATE WORKSPACE</Badge>
          <h2>{session.setupRequired ? "Make it yours." : "Welcome back."}</h2>
          <p>
            {session.setupRequired
              ? "Create the owner account for your gateway."
              : "Sign in to manage your gateway and providers."}
          </p>
          {error && (
            <div className="alert error" role="alert">
              <AlertCircle size={18} />
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            {session.setupRequired && (
              <Field
                label="Setup token"
                hint="Find this in your private deployment access file. Setup closes after the first owner."
              >
                <input
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                  minLength={24}
                  placeholder="Enter your private setup token"
                />
              </Field>
            )}
            <Field label="Email address">
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="you@example.com"
              />
            </Field>
            <Field
              label="Password"
              hint={
                session.setupRequired
                  ? "Use at least 12 characters."
                  : undefined
              }
            >
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete={
                    session.setupRequired ? "new-password" : "current-password"
                  }
                  required
                  minLength={session.setupRequired ? 12 : 1}
                  maxLength={200}
                  placeholder={
                    session.setupRequired
                      ? "Create a strong password"
                      : "Enter your password"
                  }
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <>
                  {session.setupRequired
                    ? "Create workspace"
                    : "Sign in to workspace"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <p className="auth-disclaimer">
            Only the workspace owner can sign in.
            <br />
            Gateway API keys are managed inside your dashboard.
          </p>
        </div>
        <span className="auth-copyright">
          KeyPool · Built for your workflow.
        </span>
      </section>
    </div>
  );
}
function FormError({ error }: { error: string }) {
  return error ? (
    <div className="alert error" role="alert">
      <AlertCircle size={17} />
      {error}
    </div>
  ) : null;
}
function ProviderForm({
  provider,
  onSave,
  onClose,
}: {
  provider?: Provider;
  onSave: (body: any) => Promise<void>;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState("custom"),
    [adapter, setAdapter] = useState(provider?.adapter || "openai"),
    [url, setUrl] = useState(provider?.baseUrl || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [paid, setPaid] = useState(provider?.paid ?? true);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get("name")),
      adapter,
      baseUrl: url,
      quotaGroup: String(f.get("group")),
      models: String(f.get("models"))
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      priority: Number(f.get("priority")),
      enabled: provider?.enabled ?? true,
      paid,
      allowPaid: f.get("allowPaid") === "on",
      tools: f.get("tools") === "on",
      contextLimit: f.get("context") ? Number(f.get("context")) : null,
      ...(!provider
        ? {
            initialPeriod: String(f.get("period")),
            ...(f.get("allowance") !== ""
              ? { initialAllowance: Number(f.get("allowance")) }
              : {}),
          }
        : {}),
      ...(f.get("apiKey") ? { apiKey: String(f.get("apiKey")) } : {}),
    };
    try {
      await onSave(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={provider ? "Edit provider" : "Connect a provider"}
      description="Your credential is encrypted and stays on your server."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <FormError error={error} />
        {!provider && (
          <Field label="Quick setup">
            <select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                setAdapter(presets[e.target.value].adapter);
                setUrl(presets[e.target.value].baseUrl);
              }}
            >
              <option value="custom">Custom OpenAI-compatible API</option>
              <option value="gemini">Google Gemini</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </Field>
        )}
        <div className="form-grid">
          <Field label="Provider name">
            <input
              name="name"
              defaultValue={provider?.name}
              placeholder="e.g. My Gemini project"
              maxLength={80}
              required
            />
          </Field>
          <Field label="API format">
            <select
              value={adapter}
              onChange={(e) => setAdapter(e.target.value)}
            >
              <option value="openai">OpenAI compatible</option>
              <option value="anthropic">Anthropic Messages</option>
              <option value="gemini">Gemini (OpenAI surface)</option>
            </select>
          </Field>
        </div>
        <Field
          label="Base URL"
          hint="Public HTTPS endpoint including its API version path. No /chat/completions or /messages suffix."
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://provider.example/v1"
            required
          />
        </Field>
        <Field
          label={provider ? "Replace API key (optional)" : "Provider API key"}
        >
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            required={!provider}
            placeholder={
              provider
                ? "Leave blank to keep saved key"
                : "Paste your provider API key"
            }
          />
        </Field>
        <Field
          label="Quota group / project ID"
          hint="Keys sharing an account or project must use the same group. Different keys do not necessarily mean extra capacity."
        >
          <input
            name="group"
            defaultValue={provider?.quotaGroup}
            placeholder="e.g. google-project-123"
            required
            maxLength={100}
          />
        </Field>
        {!provider && (
          <div className="form-grid">
            <Field
              label="New pool token allowance"
              hint="Optional. Shared groups keep their existing allowance; entering a second key never adds the same quota twice."
            >
              <input
                name="allowance"
                type="number"
                min={0}
                max={1000000000000}
                placeholder="e.g. 10000000"
              />
            </Field>
            <Field label="Allowance period">
              <select name="period" defaultValue="lifetime">
                <option value="lifetime">Fixed / lifetime budget</option>
                <option value="daily">Daily (UTC reset)</option>
                <option value="monthly">Monthly (UTC reset)</option>
              </select>
            </Field>
          </div>
        )}
        <Field
          label="Exact model IDs"
          hint="Use IDs from your provider's console. Separate with commas or new lines."
        >
          <textarea
            name="models"
            defaultValue={provider?.models.join("\n")}
            placeholder="Enter model IDs supported by this key"
            required
            rows={2}
          />
        </Field>
        <Field
          label="Billing policy"
          hint="Free capacity is determined by your provider account and selected model, not by KeyPool."
        >
          <select
            value={paid ? "paid" : "free"}
            onChange={(e) => setPaid(e.target.value === "paid")}
          >
            <option value="paid">
              May incur charges — budget and opt-in required
            </option>
            <option value="free">
              Free only — I verified no billing for this key/model
            </option>
          </select>
        </Field>
        <details className="advanced">
          <summary>
            Capabilities & routing options <ChevronDown size={15} />
          </summary>
          <div className="form-grid">
            <Field label="Priority (lower goes first)">
              <input
                type="number"
                name="priority"
                min={0}
                max={1000}
                defaultValue={provider?.priority ?? 10}
              />
            </Field>
            <Field label="Context limit (optional)">
              <input
                type="number"
                name="context"
                min={1024}
                defaultValue={provider?.contextLimit || ""}
                placeholder="Provider context tokens"
              />
            </Field>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              name="tools"
              defaultChecked={provider?.tools ?? true}
            />
            <span>Model supports function / tool calling</span>
          </label>
          {paid && (
            <label className="check-field warning-check">
              <input
                type="checkbox"
                name="allowPaid"
                defaultChecked={provider?.allowPaid || false}
              />
              <span>
                I allow paid requests through this credential. Set a finite
                quota-pool allowance before use. Local token allowances are
                estimates, not a provider billing cap.
              </span>
            </label>
          )}
        </details>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
            Save provider
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AliasForm({
  alias,
  providers,
  onSave,
  onClose,
}: {
  alias?: Alias;
  providers: Provider[];
  onSave: (b: any) => Promise<void>;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState(
      alias?.targets || [
        {
          providerId: providers[0]?.id || "",
          model: providers[0]?.models[0] || "",
        },
      ],
    ),
    [cross, setCross] = useState(alias?.allowCrossModel || false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (i: number, field: string, value: string) =>
    setTargets((t) =>
      t.map((v, j) =>
        j === i
          ? field === "providerId"
            ? {
                providerId: value,
                model: providers.find((p) => p.id === value)?.models[0] || "",
              }
            : { ...v, [field]: value }
          : v,
      ),
    );
  return (
    <Modal
      title={alias ? "Edit model route" : "Create a model alias"}
      description="Clients use this alias instead of a provider-specific model ID."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await onSave({
              name: new FormData(e.currentTarget).get("name"),
              targets,
              allowCrossModel: cross,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <Field label="Model alias">
          <input
            name="name"
            defaultValue={alias?.name || "coding"}
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9._/\-]{0,99}"
            placeholder="coding"
          />
        </Field>
        <div className="form-section-label">PROVIDER TARGETS</div>
        {targets.map((t, i) => (
          <div className="target-form" key={i}>
            <span className="target-order">{i + 1}</span>
            <div>
              <Field label="Provider">
                <select
                  value={t.providerId}
                  onChange={(e) => update(i, "providerId", e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select provider
                  </option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model">
                <select
                  value={t.model}
                  onChange={(e) => update(i, "model", e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select model
                  </option>
                  {providers
                    .find((p) => p.id === t.providerId)
                    ?.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            {targets.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove target ${i + 1}`}
                onClick={() => setTargets((t) => t.filter((_, j) => j !== i))}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button secondary full"
          disabled={!providers.length}
          onClick={() =>
            setTargets((t) => [
              ...t,
              {
                providerId: providers[0]?.id || "",
                model: providers[0]?.models[0] || "",
              },
            ])
          }
        >
          <Plus size={16} />
          Add fallback route
        </button>
        <label className="check-field">
          <input
            type="checkbox"
            checked={cross}
            onChange={(e) => setCross(e.target.checked)}
          />
          <span>
            Allow fallback between different models. Results and capabilities
            can change.
          </span>
        </label>
        {!providers.length && (
          <p className="inline-warning">
            Add a provider before creating a model route.
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !providers.length}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <GitBranch size={16} />
            )}
            Save route
          </button>
        </div>
      </form>
    </Modal>
  );
}
function QuotaForm({
  group,
  onSave,
  onClose,
}: {
  group: Group;
  onSave: (b: any) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Quota pool settings" description={group.id} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await onSave({
              allowance:
                f.get("allowance") === "" ? null : Number(f.get("allowance")),
              period: f.get("period"),
              timezone: f.get("timezone"),
              rpm: f.get("rpm") ? Number(f.get("rpm")) : null,
              tpm: f.get("tpm") ? Number(f.get("tpm")) : null,
              verified: false,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormError error={error} />
        <div className="alert info">
          <Database size={18} />
          <span>
            This is an owner-entered allowance, not a live provider balance.
            Include usage outside this gateway when setting your budget.
          </span>
        </div>
        <Field
          label="Token allowance"
          hint="Leave blank for Unknown. Reservations use a conservative byte-based input estimate plus maximum output."
        >
          <input
            type="number"
            name="allowance"
            min={0}
            max={1000000000000}
            defaultValue={group.allowance ?? ""}
            placeholder="Unknown"
          />
        </Field>
        <div className="form-grid">
          <Field label="Allowance period">
            <select name="period" defaultValue={group.period}>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="lifetime">Lifetime / fixed</option>
            </select>
          </Field>
          <Field
            label="Reset timezone"
            hint="IANA timezone; daylight saving is respected."
          >
            <input
              name="timezone"
              defaultValue={group.timezone || "UTC"}
              list="timezones"
              required
            />
            <datalist id="timezones">
              <option value="UTC" />
              <option value="America/Los_Angeles" />
              <option value="Asia/Kolkata" />
            </datalist>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Requests per minute (optional)">
            <input
              name="rpm"
              type="number"
              min={1}
              max={1000000}
              defaultValue={group.rpm ?? ""}
              placeholder="Unknown"
            />
          </Field>
          <Field
            label="Tokens per minute (optional)"
            hint="Conservative reservation limit across this pool."
          >
            <input
              name="tpm"
              type="number"
              min={1}
              max={1000000000}
              defaultValue={group.tpm ?? ""}
              placeholder="Unknown"
            />
          </Field>
        </div>
        <p className="muted small">
          Recorded: {number(group.consumed)} tokens · Reserved or uncertain:{" "}
          {number(group.reserved)}. Reset schedules can change only before usage
          starts. Never remove uncertain usage just to retry.
        </p>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            Save allowance
          </button>
        </div>
      </form>
    </Modal>
  );
}
function KeyForm({
  revealed,
  onSave,
  onClose,
}: {
  revealed: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={revealed ? "Your gateway key is ready" : "Generate a gateway key"}
      description={
        revealed
          ? "Copy this now. It cannot be shown again."
          : "Name the key for the tool or workflow that will use it."
      }
      onClose={onClose}
    >
      {revealed ? (
        <>
          <div className="secret-reveal">
            <code>{revealed}</code>
            <CopyButton value={revealed} label="Copy key" />
          </div>
          <div className="alert info">
            <ShieldCheck size={18} />
            <span>
              Save it in your password manager. This key grants access to your
              configured provider routes.
            </span>
          </div>
          <div className="form-actions">
            <button className="button primary" onClick={onClose}>
              I saved my key <Check size={16} />
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSave(String(new FormData(e.currentTarget).get("name")));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormError error={error} />
          <Field label="Key name">
            <input
              name="name"
              placeholder="e.g. Claude Code · laptop"
              required
              maxLength={80}
            />
          </Field>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <KeyRound size={16} />
              )}
              Generate key
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
function Connect({
  origin,
  aliases,
  providers,
  onCreateKey,
}: {
  origin: string;
  aliases: Alias[];
  providers: Provider[];
  onCreateKey: () => void;
}) {
  const [alias, setAlias] = useState(
      aliases.find((a) => a.name === "super")?.name ||
        aliases[0]?.name ||
        "super",
    ),
    [shell, setShell] = useState("powershell"),
    [testKey, setTestKey] = useState(""),
    [testResult, setTestResult] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = aliases.find((a) => a.name === alias),
    native =
      !!selected &&
      selected.targets.every(
        (t) =>
          providers.find((p) => p.id === t.providerId)?.adapter === "anthropic",
      );
  const vars = [
    ["ANTHROPIC_BASE_URL", origin],
    ["ANTHROPIC_AUTH_TOKEN", "<your-gateway-key>"],
    ["ANTHROPIC_MODEL", alias || "<your-model-alias>"],
    ["ANTHROPIC_DEFAULT_HAIKU_MODEL", alias || "<your-model-alias>"],
    ["ANTHROPIC_DEFAULT_SONNET_MODEL", alias || "<your-model-alias>"],
    ["ANTHROPIC_DEFAULT_OPUS_MODEL", alias || "<your-model-alias>"],
    ...(!native
      ? [
          ["MAX_THINKING_TOKENS", "0"],
          ["DISABLE_PROMPT_CACHING", "1"],
          ["ENABLE_TOOL_SEARCH", "false"],
          ["CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING", "1"],
          ["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", "1"],
        ]
      : []),
  ];
  const code =
    vars
      .map(([k, v]) =>
        shell === "powershell" ? `$env:${k} = "${v}"` : `export ${k}="${v}"`,
      )
      .join("\n") + "\nclaude";
  return (
    <div className="connect-grid">
      <section className="panel connect-main">
        <div className="section-heading">
          <div className="route-name">
            <span className="provider-icon">
              <Terminal size={22} />
            </span>
            <div>
              <h2>Connect Claude Code</h2>
              <p>Use your gateway in your terminal.</p>
            </div>
          </div>
          <Badge tone="amber">VERIFY PER MODEL</Badge>
        </div>
        <div className="form-grid">
          <Field label="Model alias">
            <select value={alias} onChange={(e) => setAlias(e.target.value)}>
              <option value="" disabled>
                Choose a configured alias
              </option>
              {aliases.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Terminal">
            <select value={shell} onChange={(e) => setShell(e.target.value)}>
              <option value="powershell">Windows PowerShell</option>
              <option value="bash">Bash / Zsh</option>
            </select>
          </Field>
        </div>
        <div className="code-block">
          <div>
            <span>
              <Terminal size={13} />
              {shell === "powershell" ? "powershell" : "shell"}
            </span>
            <CopyButton value={code} label="Copy config" />
          </div>
          <pre>{code}</pre>
        </div>
        <p className="muted small">
          Replace <code>&lt;your-gateway-key&gt;</code> with a generated key.
          Keep the gateway base URL as shown, without adding <code>/v1</code>.
        </p>
        <div className="alert info">
          <AlertCircle size={18} />
          <span>
            Anthropic does not officially support non-Claude models in Claude
            Code. Translation here supports text and function tools; reasoning,
            images, prompt caching and other advanced features may be
            unavailable. A connection check is not a full coding compatibility
            test.
          </span>
        </div>
        <div className="section-title">
          <h3>Check the connection</h3>
          <Badge>NO GENERATION</Badge>
        </div>
        <p className="muted small">
          This checks your gateway key and lists model aliases. It does not
          spend provider tokens or store the entered key.
        </p>
        <form
          className="connection-test"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setTestResult("");
            try {
              const r = await fetch("/v1/models", {
                headers: { Authorization: `Bearer ${testKey}` },
              });
              const b = await r.json();
              if (!r.ok)
                throw new Error(b.error?.message || "Connection failed");
              setTestResult(
                `Connected. ${b.data.length} model alias${b.data.length === 1 ? "" : "es"} available. Live generation remains unverified.`,
              );
            } catch (e) {
              setTestResult((e as Error).message);
            } finally {
              setBusy(false);
              setTestKey("");
            }
          }}
        >
          <input
            aria-label="Gateway key for connection test"
            type="password"
            value={testKey}
            onChange={(e) => setTestKey(e.target.value)}
            placeholder="Paste gateway key for this check"
            autoComplete="off"
            required
          />
          <button className="button secondary" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Zap size={16} />}
            Test
          </button>
        </form>
        {testResult && (
          <p className="test-result" role="status">
            {testResult}
          </p>
        )}
      </section>
      <div className="connect-aside">
        <section className="panel">
          <div className="note-icon">
            <KeyRound size={20} />
          </div>
          <h2>Need a gateway key?</h2>
          <p className="muted">
            Create a separate key for each tool. Revoke one without changing
            your provider credentials.
          </p>
          <button className="button primary full" onClick={onCreateKey}>
            <Plus size={16} />
            Generate key
          </button>
        </section>
        <section className="panel">
          <h2>Also works with</h2>
          <div className="integration">
            <Code2 size={20} />
            <div>
              <strong>OpenAI-compatible clients</strong>
              <code>{origin}/v1</code>
            </div>
          </div>
          <p className="muted small">
            Use the same gateway key and configured model alias. Supported
            endpoint: <code>/chat/completions</code>.
          </p>
          <a
            className="text-button"
            href="https://github.com/prarit0097/apikeywebapp"
            target="_blank"
            rel="noreferrer"
          >
            Read the documentation <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
    </div>
  );
}
