// Run via stdin in this app's container, never against another application's DB.
import { DatabaseSync, backup } from "node:sqlite";
import assert from "node:assert/strict";
const db = new DatabaseSync("/app/data/keypool.sqlite");
try {
  if (process.env.VERIFY_STAGE === "write") {
    db.prepare(
      "INSERT OR REPLACE INTO rate_limits(key,count,expires) VALUES(?,?,?)",
    ).run("verification:persistence", 42, Date.now() + 3600000);
    console.log("Persistence marker written.");
  } else if (process.env.VERIFY_STAGE === "read") {
    assert.equal(
      db
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .get("verification:persistence")?.count,
      42,
    );
    db.prepare("DELETE FROM rate_limits WHERE key=?").run(
      "verification:persistence",
    );
    const authBuckets = db
      .prepare("SELECT count(*) n FROM rate_limits WHERE key LIKE 'auth:%'")
      .get().n;
    console.log(
      JSON.stringify({
        databaseSurvivedRestart: true,
        publicAuthBuckets: authBuckets,
        ownerCount: db.prepare("SELECT count(*) n FROM owner").get().n,
      }),
    );
  } else if (process.env.VERIFY_STAGE === "backup") {
    await backup(db, "/app/data/verification-backup.sqlite");
    console.log("Online SQLite backup completed.");
  } else throw new Error("Set VERIFY_STAGE to write, read or backup.");
} finally {
  db.close();
}
