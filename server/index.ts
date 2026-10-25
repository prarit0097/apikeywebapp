import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Store } from "./store.js";
import { createApp, finishApp } from "./app.js";
import { mountGateway } from "./gateway.js";

const origin = process.env.APP_ORIGIN || "http://localhost:4000";
const production = process.env.NODE_ENV === "production";
const encryption = process.env.ENCRYPTION_KEY || "";
const bootstrap = process.env.BOOTSTRAP_TOKEN || "";
if (!/^[a-fA-F0-9]{64}$/.test(encryption) || bootstrap.length < 24)
  throw new Error(
    "Set ENCRYPTION_KEY (64 hex characters) and BOOTSTRAP_TOKEN (at least 24 characters) in the private environment",
  );
if (
  new URL(origin).origin !== origin ||
  (production && !origin.startsWith("https://"))
)
  throw new Error(
    "APP_ORIGIN must be a bare origin, using HTTPS in production",
  );
const filename = resolve(process.env.DATABASE_PATH || "data/keypool.sqlite");
mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
const store = new Store(filename);
const app = createApp({
  store,
  origin,
  encryptionKey: Buffer.from(encryption, "hex"),
  bootstrapToken: bootstrap,
  production,
});
mountGateway(app);
finishApp(app);
const server = app.listen(
  Number(process.env.PORT) || 4000,
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `KeyPool listening on port ${Number(process.env.PORT) || 4000}`,
    ),
);
server.requestTimeout = 190000;
server.headersTimeout = 30000;
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 20000).unref();
  });
