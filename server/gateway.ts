import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { z } from "zod";
import { HttpError, cleanProvider } from "./app.js";
import type { AppConfig } from "./config.js";
import {
  type Event,
  fromOpenAI,
  toOpenAI,
  collectMessage,
  messageToOpenAI,
  ProtocolError,
} from "./protocol.js";
import { providerEvents, UpstreamError, testProvider } from "./providers.js";
import { availableAliases } from "./pool.js";

const messageSchema = z
  .object({
    model: z.string().min(1).max(100),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.union([z.string(), z.array(z.any())]),
          })
          .passthrough(),
      )
      .min(1)
      .max(1000),
    max_tokens: z.number().int().min(1).max(131072).default(4096),
    stream: z.boolean().default(false),
  })
  .passthrough();
const finite = (n: any): number | null =>
  Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
export function mountGateway(app: Express) {
  const { config, owner } = (app as any).keypool as {
    config: AppConfig;
    owner: any;
  };
  const { store } = config;
  let active = 0,
    cursor = 0;
  app.post("/api/admin/providers/:id/test", owner, async (req, res) => {
    const p = store.provider(String(req.params.id));
    if (!p) throw new HttpError(404, "Provider not found");
    if (!store.rateLimit(`test:${p.id}`, 5, 60000))
      throw new HttpError(429, "Wait before testing this provider again");
    try {
      const result = await testProvider(config, p);
      const applied = store.patchProviderStatus(p, {
        status: "connected",
        testedAt: Date.now(),
      });
      res.json({
        ...result,
        provider: store.provider(p.id)
          ? cleanProvider(store.provider(p.id)!)
          : null,
        ...(!applied
          ? {
              message:
                "Configuration changed during the test. Test the current credential again.",
            }
          : {}),
      });
    } catch (e) {
      store.patchProviderStatus(p, {
        status: "test_failed",
        testedAt: Date.now(),
      });
      throw new HttpError(
        502,
        e instanceof UpstreamError
          ? `Provider rejected the check (HTTP ${e.status})`
          : "Provider connection test failed. Check endpoint and credentials.",
      );
    }
  });
  const run =
    (format: "anthropic" | "openai") => async (req: Request, res: Response) => {
      let message: any;
      try {
        message = messageSchema.parse(
          format === "openai" ? fromOpenAI(req.body) : req.body,
        );
      } catch (e) {
        if (e instanceof ProtocolError) throw new HttpError(400, e.message);
        throw e;
      }
      const alias = availableAliases(store).find(
        (a) => a.name === message.model,
      );
      if (!alias)
        throw new HttpError(
          404,
          "Model alias not found. Create it in Routing first.",
          "not_found_error",
        );
      if (active >= 8)
        throw new HttpError(
          429,
          "Gateway is busy. Retry later.",
          "rate_limit_error",
        );
      const candidates = alias.targets
        .map((t) => ({ target: t, provider: store.provider(t.providerId) }))
        .filter(
          ({ provider: p }) =>
            p?.enabled &&
            (!p.paid || p.allowPaid) &&
            (!message.tools?.length || p.tools),
        );
      const rotation = alias.name === "super" ? 0 : cursor++;
      candidates.sort(
        (a, b) =>
          a.provider!.priority - b.provider!.priority ||
          ((alias.targets.indexOf(a.target) + rotation) %
            alias.targets.length) -
            ((alias.targets.indexOf(b.target) + rotation) %
              alias.targets.length),
      );
      const reservationSize =
        Buffer.byteLength(JSON.stringify(message), "utf8") + message.max_tokens;
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 180000);
      req.on("aborted", () => ctl.abort());
      res.on("close", () => {
        if (!res.writableEnded) ctl.abort();
      });
      active++;
      const requestId = randomUUID();
      res.set("X-Request-Id", requestId);
      let attempts = 0,
        lastError: HttpError | undefined,
        unsupported: string | undefined;
      try {
        for (const { provider: p, target } of candidates) {
          if (!p || ctl.signal.aborted) break;
          if (p.contextLimit && reservationSize > p.contextLimit) continue;
          if (
            p.paid &&
            store.groups().find((g) => g.id === p.quotaGroup)?.allowance == null
          )
            continue;
          if (p.adapter !== "anthropic") {
            try {
              toOpenAI(message, target.model);
            } catch (e) {
              unsupported = (e as Error).message;
              continue;
            }
          }
          const reservation = store.reserve(p.quotaGroup, reservationSize);
          if (!reservation) continue;
          attempts++;
          const started = Date.now();
          let input: number | null = null,
            output: number | null = null,
            complete = false,
            deltaSeen = false,
            streamingStarted = false;
          let iterator: AsyncGenerator<Event> | undefined;
          try {
            iterator = providerEvents(
              config,
              p,
              message,
              target.model,
              ctl.signal,
              String(req.headers["anthropic-beta"] || ""),
              String(req.headers["anthropic-version"] || "2023-06-01"),
            );
            const first = await iterator.next();
            if (first.done) throw new ProtocolError("Empty upstream response");
            async function* tracked() {
              const capture = (e: Event) => {
                if (e.type === "message_start") {
                  const u = e.message.usage;
                  if (p!.adapter === "anthropic" && u) {
                    input = finite(
                      (u.input_tokens || 0) +
                        (u.cache_creation_input_tokens || 0) +
                        (u.cache_read_input_tokens || 0),
                    );
                  }
                }
                if (e.type === "message_delta") {
                  deltaSeen = true;
                  if (e.usage?.input_tokens !== undefined)
                    input = finite(e.usage.input_tokens);
                  if (e.usage?.output_tokens !== undefined)
                    output = finite(e.usage.output_tokens);
                }
                if (e.type === "message_stop") complete = true;
                return e;
              };
              yield capture(first.value!);
              for await (const e of iterator!) yield capture(e);
              if (!complete || !deltaSeen)
                throw new ProtocolError("Incomplete upstream response");
            }
            if (!message.stream) {
              const result = await collectMessage(tracked());
              res.json(
                format === "anthropic" ? result : messageToOpenAI(result),
              );
            } else {
              res.status(200).set({
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
              });
              res.flushHeaders();
              streamingStarted = true;
              async function write(value: string) {
                if (ctl.signal.aborted) throw new Error("Cancelled");
                if (!res.write(value))
                  await Promise.race([
                    once(res, "drain"),
                    once(res, "close").then(() => {
                      throw new Error("Cancelled");
                    }),
                  ]);
              }
              const heartbeat = setInterval(() => {
                if (!res.destroyed)
                  res.write(
                    format === "anthropic"
                      ? 'event: ping\ndata: {"type":"ping"}\n\n'
                      : ": ping\n\n",
                  );
              }, 15000);
              let model = message.model,
                id = `chatcmpl-${requestId}`,
                toolIndex = 0;
              const toolMap = new Map<number, number>();
              try {
                for await (const e of tracked()) {
                  if (format === "anthropic")
                    await write(
                      `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
                    );
                  else {
                    let delta: any = {},
                      finish: string | null = null;
                    if (e.type === "message_start") {
                      id = e.message.id;
                      model = e.message.model;
                      delta = { role: "assistant" };
                    }
                    if (
                      e.type === "content_block_start" &&
                      e.content_block.type === "tool_use"
                    ) {
                      const index = toolIndex++;
                      toolMap.set(e.index, index);
                      delta = {
                        tool_calls: [
                          {
                            index,
                            id: e.content_block.id,
                            type: "function",
                            function: {
                              name: e.content_block.name,
                              arguments: "",
                            },
                          },
                        ],
                      };
                    }
                    if (e.type === "content_block_delta") {
                      if (e.delta.type === "text_delta")
                        delta = { content: e.delta.text };
                      if (e.delta.type === "input_json_delta")
                        delta = {
                          tool_calls: [
                            {
                              index: toolMap.get(e.index),
                              function: { arguments: e.delta.partial_json },
                            },
                          ],
                        };
                    }
                    if (e.type === "message_delta")
                      finish =
                        e.delta.stop_reason === "tool_use"
                          ? "tool_calls"
                          : e.delta.stop_reason === "max_tokens"
                            ? "length"
                            : "stop";
                    if (Object.keys(delta).length || finish)
                      await write(
                        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
                      );
                  }
                }
                if (format === "openai") {
                  if (
                    req.body.stream_options?.include_usage &&
                    input !== null &&
                    output !== null
                  )
                    await write(
                      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } })}\n\n`,
                    );
                  await write("data: [DONE]\n\n");
                }
                res.end();
              } finally {
                clearInterval(heartbeat);
              }
            }
            store.settle(
              reservation,
              input !== null && output !== null ? input + output : null,
            );
            store.log({
              id: randomUUID(),
              alias: message.model,
              provider: p.name,
              keyId: res.locals.keyId,
              success: true,
              input,
              output,
              latency: Date.now() - started,
              error: null,
            });
            return;
          } catch (e) {
            const rejected = e instanceof UpstreamError;
            store.settle(
              reservation,
              rejected
                ? 0
                : input !== null && output !== null && complete
                  ? input + output
                  : null,
            );
            const reason =
              e instanceof ProtocolError
                ? "Provider returned an incomplete or unsupported response"
                : rejected
                  ? `Upstream HTTP ${e.status}`
                  : ctl.signal.aborted
                    ? "Request cancelled or timed out"
                    : "Upstream connection failed";
            store.log({
              id: randomUUID(),
              alias: message.model,
              provider: p.name,
              keyId: res.locals.keyId,
              success: false,
              input: rejected ? 0 : input,
              output: rejected ? 0 : output,
              latency: Date.now() - started,
              error: reason,
            });
            if (rejected && (e.status === 401 || e.status === 403)) {
              store.patchProviderStatus(p, {
                enabled: false,
                status: "credentials_rejected",
              });
            }
            if (rejected && (e.status === 429 || e.quotaExhausted))
              store.cooldown(
                p.quotaGroup,
                Date.now() +
                  (e.retryAfter || (e.quotaExhausted ? 24 * 3600000 : 60000)),
              );
            if (streamingStarted) {
              if (!res.destroyed && !res.writableEnded)
                res.end(
                  format === "anthropic"
                    ? `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message: `${reason}. Request ID: ${requestId}` } })}\n\n`
                    : `data: ${JSON.stringify({ error: { message: reason, type: "api_error" } })}\n\n`,
                );
              return;
            }
            lastError = new HttpError(
              rejected && e.status === 429 ? 429 : 502,
              `${reason}. Request ID: ${requestId}`,
            );
            if (
              !rejected ||
              !([401, 403, 429, 503].includes(e.status) || e.quotaExhausted)
            )
              throw lastError;
          } finally {
            await iterator?.return(undefined as any).catch(() => {});
          }
        }
        if (unsupported && !attempts) throw new HttpError(400, unsupported);
        if (lastError) throw lastError;
        throw new HttpError(
          503,
          "No eligible capacity. Check provider status, quota, model capabilities and paid-use opt-in.",
          "overloaded_error",
        );
      } finally {
        clearTimeout(timeout);
        active--;
      }
    };
  app.post("/v1/messages", run("anthropic"));
  app.post("/v1/chat/completions", run("openai"));
}
