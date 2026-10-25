// Isolated deterministic browser fixture. All upstream traffic is intercepted.
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createApp, finishApp } from "../dist/server/app.js";
import { mountGateway } from "../dist/server/gateway.js";
import { Store } from "../dist/server/store.js";

mkdirSync(".private", { recursive: true });
const run = `${Date.now()}-${process.pid}`;
const env = {
  DATABASE_PATH: path.resolve(`.private/two-field-${run}.sqlite`),
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
};
writeFileSync(
  ".private/two-field-browser.env",
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n"),
);
const store = new Store(env.DATABASE_PATH);
const upstreamCalls = [];
const app = createApp({
  store,
  origin: "http://localhost:4012",
  encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "hex"),
  bootstrapToken: env.BOOTSTRAP_TOKEN,
  production: false,
  providerFetch: async (input, options) => {
    const url = new URL(input);
    upstreamCalls.push({
      host: url.hostname,
      path: url.pathname,
      method: options.method,
    });
    let statusCode = 404;
    let value = { error: "Fixture endpoint not found" };
    if (options.method === "GET" && url.pathname.endsWith("/models")) {
      statusCode = 200;
      value = {
        data: [
          {
            id: "free-coder",
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
            context_length: 32000,
          },
        ],
      };
    } else if (options.method === "GET" && url.pathname.endsWith("/quota")) {
      statusCode = 200;
      value = {
        quota: {
          unit: "tokens",
          total: 1000,
          remaining: 750,
          period: "lifetime",
        },
      };
    }
    async function* body() {
      yield Buffer.from(JSON.stringify(value));
    }
    return {
      statusCode,
      headers: { "content-type": "application/json" },
      body: body(),
    };
  },
});
mountGateway(app);
finishApp(app);
const server = app.listen(4012, "127.0.0.1", () => {
  if (process.send) process.send({ ready: true });
  else console.log("Two-field browser fixture ready on 4012.");
});
function shutdown() {
  server.close(() => {
    writeFileSync(
      ".private/two-field-upstream.json",
      JSON.stringify(upstreamCalls, null, 2),
    );
    store.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on("message", (message) => {
  if (message === "shutdown") shutdown();
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
