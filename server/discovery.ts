import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import type { Provider } from "./store.js";
import {
  decryptSecret,
  digest,
  encryptSecret,
  validatePublicUrl,
} from "./security.js";
import {
  providerRequest,
  safeRequest,
  type UpstreamResponse,
} from "./providers.js";

export class DiscoveryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const knownNames: Record<string, string> = {
  "router.bynara.id": "NaraRouter",
  "oxionai.com": "Oxion AI",
  "www.oxionai.com": "Oxion AI",
  "api.anthropic.com": "Anthropic",
  "api.openai.com": "OpenAI",
  "generativelanguage.googleapis.com": "Google Gemini",
  "openrouter.ai": "OpenRouter",
  "api.groq.com": "Groq",
  "api.mistral.ai": "Mistral",
};
export function normalizeBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new DiscoveryError(
      "Use a public HTTPS base URL without credentials or query parameters",
    );
  let pathname = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|messages|responses|models)$/, "");
  let adapter: Provider["adapter"] = "openai";
  if (url.hostname === "generativelanguage.googleapis.com") {
    adapter = "gemini";
    pathname = "/v1beta/openai";
  } else if (url.hostname === "api.anthropic.com") {
    adapter = "anthropic";
    if (!pathname) pathname = "/v1";
  } else if (
    url.hostname === "openrouter.ai" &&
    (!pathname || pathname === "/v1")
  )
    pathname = "/api/v1";
  else if (!pathname) pathname = "/v1";
  return {
    baseUrl: url.origin + pathname,
    adapter,
    name:
      knownNames[url.hostname] ||
      url.hostname.replace(/^api\./, "").slice(0, 80),
  };
}
async function readJson(r: UpstreamResponse) {
  let text = "";
  try {
    for await (const chunk of r.body) {
      text += Buffer.from(chunk).toString("utf8");
      if (text.length > 2 * 1024 * 1024)
        throw new DiscoveryError("Provider metadata is too large");
    }
    try {
      return { status: r.statusCode, value: JSON.parse(text) };
    } catch {
      return { status: r.statusCode, value: null };
    }
  } finally {
    await r.dispose?.();
  }
}
const numeric = (v: any) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const zero = (v: any) =>
  (typeof v === "number" && v === 0) ||
  (typeof v === "string" &&
    v.trim() !== "" &&
    Number.isFinite(Number(v)) &&
    Number(v) === 0);
function free(m: any, host: string) {
  if (
    m.pricing &&
    (Object.hasOwn(m.pricing, "prompt") ||
      Object.hasOwn(m.pricing, "completion"))
  ) {
    return (
      zero(m.pricing.prompt) &&
      zero(m.pricing.completion) &&
      ![
        "request",
        "input",
        "output",
        "web_search",
        "internal_reasoning",
        "cache_read",
        "cache_write",
      ].some((k) => {
        const v = m.pricing[k];
        return (
          (typeof v === "number" ||
            (typeof v === "string" && v.trim() !== "")) &&
          Number(v) > 0
        );
      })
    );
  }
  return (
    (m.pricing && zero(m.pricing.prompt) && zero(m.pricing.completion)) ||
    m.free === true ||
    m.is_free === true ||
    (host === "openrouter.ai" && String(m.id).endsWith(":free"))
  );
}
function chat(m: any) {
  const modalities = m.architecture?.output_modalities;
  const kind = String(
    m.type ||
      m.task ||
      (Array.isArray(modalities)
        ? modalities.join(",")
        : typeof modalities === "string"
          ? modalities
          : "") ||
      "",
  ).toLowerCase();
  const id = String(m.id || m.name || "");
  if (/embedding|rerank|image|video|audio|speech|transcription|tts/.test(kind))
    return false;
  if (
    /(?:^|[\/_-])(embed|embedding|rerank|whisper|tts|image|video)(?:[\/_-]|$)/i.test(
      id,
    )
  )
    return false;
  if (
    Array.isArray(m.supportedGenerationMethods) &&
    !m.supportedGenerationMethods.includes("generateContent")
  )
    return false;
  return true;
}
function tools(m: any): boolean | null {
  if (typeof m.capabilities?.tools === "boolean") return m.capabilities.tools;
  if (typeof m.supports_tools === "boolean") return m.supports_tools;
  if (Array.isArray(m.supported_parameters))
    return m.supported_parameters.some(
      (p: any) => p === "tools" || p === "tool_choice",
    );
  return null;
}
function tokenQuota(value: any, source: string) {
  const q =
    value?.token_quota ||
    value?.quota ||
    value?.data?.token_quota ||
    value?.data?.quota;
  if (!q || q.unit !== "tokens") return null;
  const total = numeric(q.total),
    remaining = numeric(q.remaining);
  if (
    total === null ||
    remaining === null ||
    remaining > total ||
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(remaining) ||
    total > 1e12 ||
    !["daily", "monthly", "lifetime"].includes(q.period)
  )
    return null;
  const timezone = q.timezone || "UTC";
  if (typeof timezone !== "string" || !DateTime.now().setZone(timezone).isValid)
    return null;
  return {
    total,
    remaining,
    period: q.period as "daily" | "monthly" | "lifetime",
    timezone,
    source,
  };
}

export async function discoverProvider(
  config: AppConfig,
  input: { baseUrl: string; apiKey?: string },
  previous?: Provider,
) {
  const normalized = normalizeBaseUrl(input.baseUrl);
  if (
    previous &&
    !input.apiKey &&
    new URL(previous.baseUrl).origin !== new URL(normalized.baseUrl).origin
  )
    throw new DiscoveryError(
      "Re-enter the API key when connecting a new origin",
    );
  if (!input.apiKey && !previous)
    throw new DiscoveryError("API key is required");
  try {
    await validatePublicUrl(normalized.baseUrl);
  } catch {
    throw new DiscoveryError("Use a public HTTPS provider URL on port 443");
  }
  const apiKey =
    input.apiKey || decryptSecret(previous!.encryptedKey, config.encryptionKey);
  if (normalized.baseUrl.includes(apiKey))
    throw new DiscoveryError(
      "Keep the API key in its separate field, not inside the base URL",
    );
  const signal = AbortSignal.timeout(25000);
  const origin = new URL(normalized.baseUrl).origin;
  const provider: Provider = {
    id: previous?.id || randomUUID(),
    name: normalized.name,
    adapter: normalized.adapter,
    baseUrl: normalized.baseUrl,
    encryptedKey: input.apiKey
      ? encryptSecret(apiKey, config.encryptionKey)
      : previous!.encryptedKey,
    keySuffix: apiKey.slice(-4),
    quotaGroup:
      previous && new URL(previous.baseUrl).origin === origin
        ? previous.quotaGroup
        : `auto:${new URL(origin).hostname}:${digest(origin).slice(0, 12)}`,
    models: [],
    priority: previous?.priority ?? 10,
    enabled: false,
    paid: true,
    allowPaid: false,
    tools: true,
    contextLimit: null,
    status: "discovery_pending",
    testedAt: Date.now(),
  };
  if (!previous) {
    const existing = config.store.providers().find((p) => {
      try {
        return new URL(p.baseUrl).origin === origin;
      } catch {
        return false;
      }
    });
    if (existing) provider.quotaGroup = existing.quotaGroup;
  }
  const notes: string[] = [];
  let catalog: any = null;
  let authFailure = false;
  const candidates = [normalized.baseUrl];
  if (
    new URL(input.baseUrl).pathname === "/" ||
    new URL(input.baseUrl).pathname === ""
  )
    candidates.push(origin, origin + "/api/v1");
  for (const base of [...new Set(candidates)]) {
    if (signal.aborted) break;
    provider.baseUrl = base;
    try {
      const result = await readJson(
        await providerRequest(config, provider, "models", "GET", signal),
      );
      if (result.status === 401 || result.status === 403) {
        authFailure = true;
        if (provider.adapter === "openai") {
          const native = { ...provider, adapter: "anthropic" as const };
          const alternate = await readJson(
            await providerRequest(config, native, "models", "GET", signal),
          );
          if (
            alternate.status === 200 &&
            Array.isArray(alternate.value?.data)
          ) {
            provider.adapter = "anthropic";
            catalog = alternate.value;
            break;
          }
        }
        continue;
      }
      if (
        result.status === 200 &&
        (Array.isArray(result.value?.data) ||
          Array.isArray(result.value?.models))
      ) {
        catalog = result.value;
        break;
      }
    } catch {
      notes.push(
        "A metadata endpoint did not respond or returned unsupported data",
      );
    }
  }
  if (!catalog && provider.adapter === "gemini" && !signal.aborted) {
    try {
      const r = await readJson(
        await (config.providerFetch || safeRequest)(
          new URL(origin + "/v1beta/models"),
          {
            method: "GET",
            headers: { "x-goog-api-key": apiKey, Accept: "application/json" },
            signal,
          },
        ),
      );
      if (r.status === 200 && Array.isArray(r.value?.models)) catalog = r.value;
    } catch {
      /* metadata only; no guesses */
    }
  }
  if (!catalog && authFailure)
    throw new DiscoveryError(
      "Provider rejected the API key or model-list access. Check the key and base URL.",
    );
  if (!catalog) provider.baseUrl = normalized.baseUrl;
  const raw = Array.isArray(catalog?.data)
    ? catalog.data
    : Array.isArray(catalog?.models)
      ? catalog.models
      : [];
  const models = raw
    .slice(0, 1000)
    .filter((m: any) => m && typeof m === "object")
    .map((m: any) => ({
      ...m,
      id:
        typeof m.id === "string"
          ? m.id
          : typeof m.name === "string"
            ? m.name.replace(/^models\//, "")
            : "",
    }))
    .filter(
      (m: any) =>
        m.id.length > 0 &&
        m.id.length <= 150 &&
        !m.id.includes(apiKey) &&
        chat(m),
    );
  const host = new URL(provider.baseUrl).hostname;
  const planFreeModels = new Set<string>();
  if (host === "router.bynara.id" && models.length && !signal.aborted) {
    try {
      // Nara's authenticated model list reports entitlement, not pricing. Its
      // public free-plan catalogue supplies the missing free eligibility.
      const result = await readJson(
        await (config.providerFetch || safeRequest)(
          new URL("/api/plans", origin),
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "Mozilla/5.0",
            },
            signal,
          },
        ),
      );
      if (result.status === 200 && Array.isArray(result.value?.data)) {
        for (const plan of result.value.data.slice(0, 100)) {
          if (
            plan?.code === "free" &&
            plan.is_active === true &&
            zero(plan.price_daily_idr) &&
            zero(plan.price_weekly_idr) &&
            Array.isArray(plan.models)
          ) {
            for (const id of plan.models.slice(0, 1000))
              if (typeof id === "string") planFreeModels.add(id);
          }
        }
      }
    } catch {
      // Missing public metadata never establishes free eligibility.
    }
  }
  const priceFields = [
    "prompt",
    "completion",
    "request",
    "input",
    "output",
    "web_search",
    "internal_reasoning",
    "cache_read",
    "cache_write",
    "input_per_1k",
    "output_per_1k",
  ];
  const freeModels = models.filter((m: any) => {
    if (
      priceFields.some(
        (key) =>
          m.pricing && Object.hasOwn(m.pricing, key) && !zero(m.pricing[key]),
      )
    )
      return false;
    return free(m, host) || planFreeModels.has(m.id);
  });
  if (freeModels.some((m: any) => planFreeModels.has(m.id)))
    notes.push(
      "Free eligibility confirmed by the official public free plan and authenticated model entitlement; public plan caps are not an account balance",
    );
  const selected = (freeModels.length ? freeModels : models)
    .sort(
      (a: any, b: any) =>
        Number(tools(b) === true) - Number(tools(a) === true) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 100);
  provider.models = selected.map((m: any) => m.id);
  const chosen = selected[0];
  const toolSupport = chosen ? tools(chosen) : null;
  provider.tools = toolSupport !== false;
  const context = numeric(
    chosen?.context_length ?? chosen?.context_window ?? chosen?.inputTokenLimit,
  );
  provider.contextLimit =
    context !== null &&
    Number.isSafeInteger(context) &&
    context > 0 &&
    context <= 10000000
      ? context
      : null;
  provider.paid = freeModels.length === 0;
  provider.enabled = freeModels.length > 0;
  provider.status = freeModels.length
    ? "connected"
    : models.length
      ? "billing_unverified"
      : "discovery_pending";
  const previousBudget = previous
    ? config.store.groups().find((g) => g.id === previous.quotaGroup)?.allowance
    : null;
  const retainedBudget =
    freeModels.length === 0 &&
    models.length > 0 &&
    previous?.paid === true &&
    previous.allowPaid === true &&
    new URL(previous.baseUrl).origin === origin &&
    (!input.apiKey ||
      apiKey === decryptSecret(previous.encryptedKey, config.encryptionKey)) &&
    typeof previousBudget === "number" &&
    Number.isSafeInteger(previousBudget) &&
    previousBudget >= 0;
  if (retainedBudget) {
    provider.allowPaid = true;
    provider.enabled = previous!.enabled;
    provider.status = provider.enabled ? "connected" : "paused";
    notes.push(
      "Existing explicit paid-plan authorization and finite pool budget retained; provider pricing is not classified as free",
    );
  }
  let quota = tokenQuota(catalog, provider.baseUrl + "/models");
  const extra: Record<string, any>[] = [];
  const suffixes =
    new URL(provider.baseUrl).hostname === "openrouter.ai"
      ? ["key", "credits"]
      : ["quota", "usage"];
  for (const suffix of suffixes) {
    if (signal.aborted) break;
    try {
      const result = await readJson(
        await providerRequest(config, provider, suffix, "GET", signal),
      );
      if (
        result.status === 200 &&
        result.value &&
        typeof result.value === "object" &&
        !Array.isArray(result.value)
      ) {
        extra.push(result.value);
        quota ||= tokenQuota(result.value, provider.baseUrl + "/" + suffix);
      }
    } catch {
      /* Optional metadata cannot make model discovery fail. */
    }
  }
  const groupVerified = false;
  notes.push(
    "Automatic setup conservatively shares quota across this upstream origin; inconsistent account metadata never creates extra capacity",
  );
  if (toolSupport === null)
    notes.push("Tool support is unverified; model metadata did not declare it");
  if (!quota)
    notes.push(
      retainedBudget
        ? "Provider token allowance was not exposed; the existing owner-configured pool budget remains in effect"
        : "No token-denominated allowance was exposed; quota remains Unknown",
    );
  if (provider.status === "billing_unverified")
    notes.push(
      "No provider-declared free model was found; saved without enabling potentially paid routing",
    );
  if (!models.length)
    notes.push(
      "No supported chat model list could be discovered; saved paused for retry",
    );
  provider.discovery = {
    checkedAt: Date.now(),
    modelsFound: models.length,
    freeModelsFound: freeModels.length,
    groupVerified,
    toolSupport:
      toolSupport === null
        ? "unverified"
        : toolSupport
          ? "reported"
          : "unsupported",
    quotaSource: quota?.source || null,
    notes,
  };
  const message = retainedBudget
    ? `Detected ${provider.name}; existing authorized pool budget retained. Provider ${provider.enabled ? "enabled" : "remains paused"}.`
    : provider.enabled
      ? `Detected ${provider.name}: ${provider.models.length} free model(s). Token quota ${quota ? "detected from provider" : "not exposed"}.`
      : provider.status === "billing_unverified"
        ? `Detected ${provider.name}; free usage could not be confirmed. Credential saved paused.`
        : `Credential saved. Model discovery is pending; retry detection later.`;
  return { provider, tokenQuota: quota, message };
}
