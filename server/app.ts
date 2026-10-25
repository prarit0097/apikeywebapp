import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import {
  digest,
  token,
  same,
  encryptSecret,
  hashPassword,
  verifyPassword,
  validatePublicUrl,
} from "./security.js";
import type { Provider, Alias } from "./store.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "invalid_request_error",
  ) {
    super(message);
  }
}
export const cleanProvider = (p: Provider) => {
  const { encryptedKey, ...safe } = p;
  return safe;
};
const providerSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    adapter: z.enum(["anthropic", "openai", "gemini"]),
    baseUrl: z.string().url().max(500),
    apiKey: z.string().min(1).max(4096).optional(),
    quotaGroup: z.string().trim().min(1).max(100),
    models: z.array(z.string().trim().min(1).max(150)).min(1).max(100),
    priority: z.number().int().min(0).max(1000).default(10),
    enabled: z.boolean().default(true),
    paid: z.boolean().default(false),
    allowPaid: z.boolean().default(false),
    tools: z.boolean().default(true),
    contextLimit: z
      .number()
      .int()
      .min(1024)
      .max(10000000)
      .nullable()
      .default(null),
  })
  .strict();
const aliasSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/),
    targets: z
      .array(
        z.object({ providerId: z.string(), model: z.string().min(1) }).strict(),
      )
      .min(1)
      .max(30),
    allowCrossModel: z.boolean().default(false),
  })
  .strict();

export function createApp(config: AppConfig) {
  const { store, origin, production } = config;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (production) res.set("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api") || req.path.startsWith("/v1"))
      res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  function session(req: Request) {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("kp_session="))
      ?.slice(11);
    if (!raw || raw.length > 200) return null;
    const row = store.get(
      "SELECT * FROM sessions WHERE hash=? AND expires>?",
      digest(raw),
      Date.now(),
    );
    return row || null;
  }
  function exactOrigin(req: Request) {
    if (req.headers.origin !== origin)
      throw new HttpError(403, "Request origin is not allowed");
  }
  function owner(req: Request, res: Response, next: NextFunction) {
    try {
      const s = session(req);
      if (!s)
        throw new HttpError(401, "Sign in to continue", "authentication_error");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        exactOrigin(req);
        if (!same(String(req.headers["x-csrf-token"] || ""), s.csrf))
          throw new HttpError(403, "Refresh your session and try again");
      }
      res.locals.session = s;
      next();
    } catch (e) {
      next(e);
    }
  }
  function loginSession(res: Response) {
    store.run("DELETE FROM sessions WHERE expires<=?", Date.now());
    const raw = token(),
      csrf = token();
    store.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      digest(raw),
      csrf,
      Date.now() + 12 * 3600000,
    );
    res.cookie("kp_session", raw, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
      maxAge: 12 * 3600000,
    });
    return csrf;
  }
  function authRate(req: Request) {
    if (!store.rateLimit(`auth:${req.ip}`, 25, 15 * 60000))
      throw new HttpError(
        429,
        "Too many attempts. Try again in 15 minutes.",
        "rate_limit_error",
      );
  }
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/session", (req, res) => {
    const s = session(req);
    const account = store.get("SELECT email FROM owner WHERE id=1");
    res.json({
      setupRequired: !account,
      authenticated: !!s,
      email: s ? account?.email : null,
      csrf: s?.csrf || null,
      origin,
    });
  });
  app.post("/api/setup", async (req, res) => {
    exactOrigin(req);
    authRate(req);
    if (store.get("SELECT id FROM owner WHERE id=1"))
      throw new HttpError(409, "Owner account already exists");
    const body = z
      .object({
        token: z.string().max(200),
        email: z.string().email().max(200),
        password: z.string().min(12).max(200),
      })
      .strict()
      .parse(req.body);
    if (!same(body.token, config.bootstrapToken))
      throw new HttpError(403, "Invalid setup token");
    const password = await hashPassword(body.password);
    store.transaction(() => {
      if (store.get("SELECT id FROM owner WHERE id=1"))
        throw new HttpError(409, "Owner account already exists");
      store.run("INSERT INTO owner VALUES(1,?,?)", body.email, password);
    });
    res.status(201).json({ csrf: loginSession(res), email: body.email });
  });
  app.post("/api/login", async (req, res) => {
    exactOrigin(req);
    authRate(req);
    const b = z
      .object({
        email: z.string().email().max(200),
        password: z.string().max(200),
      })
      .strict()
      .parse(req.body);
    const account = store.get("SELECT * FROM owner WHERE id=1");
    if (
      !account ||
      !(await verifyPassword(b.password, account.password)) ||
      !same(b.email.toLowerCase(), account.email.toLowerCase())
    )
      throw new HttpError(
        401,
        "Email or password is incorrect",
        "authentication_error",
      );
    res.json({ csrf: loginSession(res), email: account.email });
  });
  app.post("/api/logout", owner, (_req, res) => {
    store.run("DELETE FROM sessions WHERE hash=?", res.locals.session.hash);
    res.clearCookie("kp_session", {
      path: "/",
      httpOnly: true,
      secure: production,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });
  app.use("/api/admin", owner);
  app.get("/api/admin/providers", (_req, res) =>
    res.json(store.providers().map(cleanProvider)),
  );
  async function saveProvider(req: Request, res: Response) {
    const id = String(req.params.id || randomUUID()),
      previous = req.params.id ? store.provider(id) : undefined;
    if (req.params.id && !previous)
      throw new HttpError(404, "Provider not found");
    const b = providerSchema.parse(req.body);
    if (!previous && !b.apiKey) throw new HttpError(400, "API key is required");
    try {
      await validatePublicUrl(b.baseUrl);
    } catch {
      throw new HttpError(400, "Use a public HTTPS upstream URL on port 443");
    }
    const existingGroup = store.groups().find((g) => g.id === b.quotaGroup);
    if (!existingGroup)
      store.saveGroup({ id: b.quotaGroup, allowance: null, period: "daily" });
    const { apiKey, ...fields } = b;
    const p: Provider = {
      ...fields,
      id,
      baseUrl: b.baseUrl.replace(/\/+$/, ""),
      encryptedKey: apiKey
        ? encryptSecret(apiKey, config.encryptionKey)
        : previous!.encryptedKey,
      keySuffix: apiKey ? apiKey.slice(-4) : previous!.keySuffix,
      status: "untested",
      testedAt: null,
    };
    store.saveProvider(p);
    res.status(previous ? 200 : 201).json(cleanProvider(p));
  }
  app.post("/api/admin/providers", saveProvider);
  app.put("/api/admin/providers/:id", saveProvider);
  app.patch("/api/admin/providers/:id", (req, res) => {
    const p = store.provider(String(req.params.id));
    if (!p) throw new HttpError(404, "Provider not found");
    const b = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    p.enabled = b.enabled;
    store.saveProvider(p);
    res.json(cleanProvider(p));
  });
  app.delete("/api/admin/providers/:id", (req, res) => {
    const id = String(req.params.id);
    if (store.aliases().some((a) => a.targets.some((t) => t.providerId === id)))
      throw new HttpError(
        409,
        "Remove this provider from routing aliases first",
      );
    store.run("DELETE FROM providers WHERE id=?", id);
    res.json({ ok: true });
  });
  app.get("/api/admin/groups", (_req, res) => res.json(store.groups()));
  app.put("/api/admin/groups/:id", (req, res) => {
    const b = z
      .object({
        allowance: z.number().int().min(0).max(1000000000000).nullable(),
        period: z.enum(["daily", "monthly", "lifetime"]),
        verified: z.literal(false).default(false),
        timezone: z.string().min(1).max(100).default("UTC"),
        rpm: z.number().int().min(1).max(1000000).nullable().default(null),
        tpm: z.number().int().min(1).max(1000000000).nullable().default(null),
      })
      .strict()
      .parse(req.body);
    try {
      store.saveGroup({ id: String(req.params.id), ...b });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    res.json(store.groups());
  });
  app.get("/api/admin/aliases", (_req, res) => res.json(store.aliases()));
  function saveAlias(req: Request, res: Response) {
    const b = aliasSchema.parse(req.body);
    for (const target of b.targets) {
      const p = store.provider(target.providerId);
      if (!p || !p.models.includes(target.model))
        throw new HttpError(
          400,
          "Every target must use a configured provider model",
        );
    }
    if (!b.allowCrossModel && new Set(b.targets.map((t) => t.model)).size > 1)
      throw new HttpError(
        400,
        "Different model fallbacks require explicit opt-in",
      );
    const a: Alias = { id: String(req.params.id || randomUUID()), ...b };
    const existing = store
      .aliases()
      .find((x) => x.name === a.name && x.id !== a.id);
    if (existing) throw new HttpError(409, "Alias name already exists");
    store.saveAlias(a);
    res.status(req.params.id ? 200 : 201).json(a);
  }
  app.post("/api/admin/aliases", saveAlias);
  app.put("/api/admin/aliases/:id", saveAlias);
  app.delete("/api/admin/aliases/:id", (req, res) => {
    store.run("DELETE FROM aliases WHERE id=?", String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/admin/keys", (_req, res) =>
    res.json(
      store.all(
        "SELECT id,name,prefix,created,last_used,revoked FROM gateway_keys ORDER BY created DESC",
      ),
    ),
  );
  app.post("/api/admin/keys", (req, res) => {
    const b = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body);
    const key = `kp_${token()}`,
      id = randomUUID();
    store.run(
      "INSERT INTO gateway_keys(id,name,hash,prefix,created) VALUES(?,?,?,?,?)",
      id,
      b.name,
      digest(key),
      key.slice(0, 10),
      Date.now(),
    );
    res.status(201).json({ id, name: b.name, key });
  });
  app.delete("/api/admin/keys/:id", (req, res) => {
    store.run(
      "UPDATE gateway_keys SET revoked=1 WHERE id=?",
      String(req.params.id),
    );
    res.json({ ok: true });
  });
  app.get("/api/admin/usage", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    res.json(
      store.all("SELECT * FROM usage ORDER BY created DESC LIMIT ?", limit),
    );
  });
  app.get("/api/admin/overview", (_req, res) => {
    const stats = store.get(
      "SELECT COUNT(*) requests,COALESCE(SUM(success),0) successes,SUM(input_tokens) inputTokens,SUM(output_tokens) outputTokens,AVG(latency) latency FROM usage WHERE created>?",
      Date.now() - 86400000,
    );
    res.json({
      stats,
      providers: store.providers().map(cleanProvider),
      groups: store.groups(),
      aliases: store.aliases(),
      keys: store.get("SELECT COUNT(*) count FROM gateway_keys WHERE revoked=0")
        .count,
      recent: store.all("SELECT * FROM usage ORDER BY created DESC LIMIT 8"),
      updatedAt: Date.now(),
    });
  });
  app.use("/v1", (req, res, next) => {
    try {
      const auth = req.headers.authorization;
      const raw = auth?.startsWith("Bearer ")
        ? auth.slice(7)
        : String(req.headers["x-api-key"] || "");
      if (!raw || raw.length > 256)
        throw new HttpError(
          401,
          "Valid gateway API key required",
          "authentication_error",
        );
      if (!store.rateLimit(`gateway-auth:${req.ip}`, 300, 60000))
        throw new HttpError(429, "Too many requests", "rate_limit_error");
      const row = store.get(
        "SELECT * FROM gateway_keys WHERE hash=? AND revoked=0",
        digest(raw),
      );
      if (!row)
        throw new HttpError(
          401,
          "Invalid or revoked gateway key",
          "authentication_error",
        );
      if (!store.rateLimit(`gateway:${row.id}`, 120, 60000))
        throw new HttpError(
          429,
          "Gateway key rate limit exceeded",
          "rate_limit_error",
        );
      store.run(
        "UPDATE gateway_keys SET last_used=? WHERE id=?",
        Date.now(),
        row.id,
      );
      res.locals.keyId = row.id;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get("/v1/models", (_req, res) =>
    res.json({
      object: "list",
      data: store
        .aliases()
        .map((a) => ({
          id: a.name,
          object: "model",
          created: 0,
          owned_by: "keypool",
        })),
    }),
  );
  // Gateway and provider tests are registered through this hook before final middleware.
  (app as any).keypool = { config, owner };
  return app;
}

export function finishApp(app: express.Express) {
  const client = path.resolve("dist/client");
  if (existsSync(client)) {
    app.use(express.static(client, { index: false, maxAge: "1h" }));
    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/v1/"))
        return next();
      res
        .set("Cache-Control", "no-cache")
        .sendFile(path.join(client, "index.html"));
    });
  }
  app.use((_req, _res, next) =>
    next(new HttpError(404, "Endpoint not found", "not_found_error")),
  );
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError || error?.type === "entity.parse.failed"
          ? 400
          : error?.type === "entity.too.large"
            ? 413
            : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".") || "Request"}: ${i.message}`)
              .join("; ")
              .slice(0, 600)
          : status === 400
            ? "Invalid JSON request"
            : status === 413
              ? "Request is too large"
              : "An internal error occurred";
    res
      .status(status)
      .json({
        type: "error",
        error: {
          type:
            error instanceof HttpError
              ? error.code
              : status === 400
                ? "invalid_request_error"
                : "api_error",
          message,
        },
      });
  });
  return app;
}
