import { Agent, request as httpRequest } from "undici";
import type { Provider } from "./store.js";
import type { AppConfig } from "./config.js";
import { decryptSecret, resolvePublic, validatePublicUrl } from "./security.js";
import {
  type Event,
  readSSE,
  openAIEvents,
  toOpenAI,
  ProtocolError,
} from "./protocol.js";

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public retryAfter: number | null = null,
  ) {
    super(`Upstream returned HTTP ${status}`);
  }
}
export type UpstreamResponse = {
  statusCode: number;
  headers: Record<string, any>;
  body: AsyncIterable<Uint8Array>;
  dispose?: () => Promise<void>;
};
export async function safeRequest(
  url: URL,
  options: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
): Promise<UpstreamResponse> {
  await validatePublicUrl(url.origin + url.pathname);
  const addresses = await resolvePublic(url.hostname);
  const selected = addresses.find((a) => a.family === 4) || addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: ((_host: any, opts: any, callback: any) => {
        if (opts?.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      }) as any,
      timeout: 15000,
    },
  });
  // Undici request does not follow redirects unless a redirect interceptor is installed.
  try {
    const r = await httpRequest(url, {
      ...options,
      dispatcher,
      headersTimeout: 30000,
      bodyTimeout: 90000,
    });
    return {
      statusCode: r.statusCode,
      headers: r.headers,
      body: r.body,
      dispose: async () => {
        r.body.destroy();
        await dispatcher.destroy();
      },
    };
  } catch (e) {
    await dispatcher.destroy();
    throw e;
  }
}
export function upstreamUrl(p: Provider, suffix: string) {
  return new URL(`${p.baseUrl.replace(/\/+$/, "")}/${suffix}`);
}
export async function providerRequest(
  config: AppConfig,
  p: Provider,
  suffix: string,
  method: "GET" | "POST",
  signal: AbortSignal,
  body?: any,
  beta?: string,
  version?: string,
): Promise<UpstreamResponse> {
  const key = decryptSecret(p.encryptedKey, config.encryptionKey);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: method === "GET" ? "application/json" : "text/event-stream",
  };
  if (p.adapter === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = version || "2023-06-01";
    if (beta) headers["anthropic-beta"] = beta;
  } else headers.Authorization = `Bearer ${key}`;
  return (config.providerFetch || safeRequest)(upstreamUrl(p, suffix), {
    method,
    headers,
    signal,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
export function retryDelay(value: any) {
  if (!value) return 60000;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(String(value)) - Date.now();
  return Math.min(
    24 * 3600000,
    Math.max(1000, Number.isFinite(ms) ? ms : 60000),
  );
}
async function discard(r: UpstreamResponse) {
  try {
    if (r.dispose) await r.dispose();
    else
      for await (const _ of r.body) {
        /* drain mock/error stream */
      }
  } catch {
    /* error content is deliberately not exposed */
  }
}
export async function* providerEvents(
  config: AppConfig,
  p: Provider,
  message: any,
  model: string,
  signal: AbortSignal,
  beta?: string,
  version?: string,
): AsyncGenerator<Event> {
  const body =
    p.adapter === "anthropic"
      ? { ...message, model, stream: true }
      : toOpenAI(message, model);
  const r = await providerRequest(
    config,
    p,
    p.adapter === "anthropic" ? "messages" : "chat/completions",
    "POST",
    signal,
    body,
    beta,
    version,
  );
  if (r.statusCode < 200 || r.statusCode >= 300) {
    await discard(r);
    throw new UpstreamError(
      r.statusCode,
      r.statusCode === 429 ? retryDelay(r.headers["retry-after"]) : null,
    );
  }
  try {
    if (p.adapter !== "anthropic") {
      yield* openAIEvents(readSSE(r.body), message.model);
      return;
    }
    let ended = false;
    for await (const raw of readSSE(r.body)) {
      let e: Event;
      try {
        e = JSON.parse(raw.data);
      } catch {
        throw new ProtocolError("Invalid upstream event");
      }
      if (e.type === "error") throw new ProtocolError("Provider stream failed");
      if (e.type === "message_start")
        e.message = { ...e.message, model: message.model };
      if (e.type === "message_stop") ended = true;
      yield e;
    }
    if (!ended) throw new ProtocolError("Incomplete upstream stream");
  } finally {
    await r.dispose?.();
  }
}
export async function testProvider(config: AppConfig, p: Provider) {
  const signal = AbortSignal.timeout(20000);
  const r = await providerRequest(config, p, "models", "GET", signal);
  try {
    if (r.statusCode < 200 || r.statusCode >= 300)
      throw new UpstreamError(r.statusCode);
    let body = "";
    for await (const chunk of r.body) {
      body += Buffer.from(chunk).toString("utf8");
      if (body.length > 2 * 1024 * 1024) throw new Error("Response too large");
    }
    const value = JSON.parse(body);
    return {
      ok: true,
      models: (value.data || [])
        .map((m: any) => m.id)
        .filter((v: any) => typeof v === "string")
        .slice(0, 100),
      message:
        "Credentials accepted by model-list endpoint. Generation and Claude Code tool use are not yet verified.",
    };
  } finally {
    await r.dispose?.();
  }
}
