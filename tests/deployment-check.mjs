import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const origin = "https://api.praritsidana.com";
const checks = [];
for (const [path, status] of [
  ["/", 200],
  ["/healthz", 200],
  ["/api/session", 200],
  ["/api/admin/providers", 401],
  ["/v1/models", 401],
]) {
  const r = await fetch(origin + path);
  assert.equal(r.status, status, path);
  checks.push({ path, status: r.status });
  if (path === "/healthz") assert.equal((await r.json()).status, "ok");
}
const redirect = await fetch("http://api.praritsidana.com/", {
  redirect: "manual",
});
assert.equal(redirect.status, 301);
assert.equal(redirect.headers.get("location"), origin + "/");
const invalid = await fetch(origin + "/api/setup", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://untrusted.example",
  },
  body: JSON.stringify({ token: "invalid" }),
});
assert.equal(invalid.status, 403);
for (const spoof of ["8.8.8.8", "1.1.1.1"]) {
  const r = await fetch(origin + "/api/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-Forwarded-For": spoof,
    },
    body: JSON.stringify({
      token: "not-a-real-token",
      email: "check@example.com",
      password: "not-a-real-password-123",
    }),
  });
  assert.equal(r.status, 403);
}
const secretPath = await fetch(origin + "/.env");
assert.ok(!(await secretPath.text()).includes("ENCRYPTION_KEY="));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(origin);
await page.getByRole("heading", { name: "Make it yours." }).waitFor();
await page.screenshot({
  path: ".private/production-setup.png",
  fullPage: true,
});
await page.setViewportSize({ width: 375, height: 812 });
assert.equal(
  await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
  false,
);
await page.screenshot({
  path: ".private/production-mobile.png",
  fullPage: true,
});
await browser.close();
assert.deepEqual(errors, []);
const result = {
  passed: true,
  origin,
  checks,
  httpRedirect: 301,
  untrustedOrigin: 403,
  secretFileExposed: false,
  browserErrors: errors,
  mobileOverflow: false,
  checkedAt: new Date().toISOString(),
};
writeFileSync(
  ".private/deployment-check.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
