import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  readFileSync(".private/super-browser.env", "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let polls = 0;
page.on("request", (r) => {
  if (r.url().endsWith("/api/admin/overview")) polls++;
});
await page.goto("http://localhost:4000");
await page.getByLabel("Setup token").fill(env.BOOTSTRAP_TOKEN);
await page.getByLabel("Email address").fill("super-qa@example.com");
await page.getByLabel(/^Password/).fill("super-browser-password-123");
await page.getByRole("button", { name: "Create workspace" }).click();
await page.getByRole("heading", { name: "One key. Every provider." }).waitFor();
const ownerSession = await page.request
  .get("http://localhost:4000/api/session")
  .then((r) => r.json());
for (const [name, group, key, allowance] of [
  ["Platform A", "project-a", "fixture-key-a", 10000000],
  ["Platform B", "project-b", "fixture-key-b", 3000000],
  ["Platform C", "project-c", "fixture-key-c", 3000000000],
  ["Platform A second key", "project-a", "fixture-key-a2", 10000000],
]) {
  // Seed independently specified fixture budgets via the legacy management API;
  // onboarding itself is covered by the two-field browser acceptance.
  const seeded = await page.request.post(
    "http://localhost:4000/api/admin/providers",
    {
      headers: {
        Origin: "http://localhost:4000",
        "X-CSRF-Token": ownerSession.csrf,
      },
      data: {
        name,
        adapter: "openai",
        baseUrl: "https://example.com/v1",
        apiKey: key,
        quotaGroup: group,
        models: ["fixture-model"],
        paid: false,
        initialAllowance: allowance,
        initialPeriod: "lifetime",
      },
    },
  );
  assert.equal(seeded.status(), 201);
}
const quota = page.getByRole("region", { name: "Super key quota" });
await quota.getByText("3.013B", { exact: true }).first().waitFor();
assert.ok((await quota.innerText()).includes("3 independent quota pools"));
await page.getByRole("link", { name: "Gateway keys", exact: true }).click();
await page.getByRole("button", { name: "Generate key", exact: true }).click();
await page.getByLabel("Key name").fill("All apps super key");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Generate key", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Your gateway key is ready" })
  .waitFor();
const key = await page.locator(".secret-reveal code").innerText();
await page.getByRole("button", { name: "I saved my key" }).click();
const pollsBeforeExternal = polls;
for (const endpoint of ["/v1/messages", "/v1/chat/completions"]) {
  const r = await page.request.post("http://localhost:4000" + endpoint, {
    headers: { Authorization: `Bearer ${key}` },
    data: {
      model: "super",
      max_tokens: 32,
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(r.status(), 200);
}
const state = await page.request.get("http://localhost:4000/v1/quota", {
  headers: { Authorization: `Bearer ${key}` },
});
const summary = await state.json();
assert.equal(summary.totalQuota, 3013000000);
assert.equal(summary.balanceQuota, 3012999970);
assert.equal(summary.keyUsedQuota, 30);
assert.equal(summary.coolingPools, 1);
await quota
  .getByText("3,012,999,970 tokens", { exact: true })
  .waitFor({ timeout: 12000 });
await page.locator("tbody").getByText("30", { exact: true }).waitFor();
assert.ok(polls > pollsBeforeExternal);
await page.screenshot({
  path: ".private/superkey-desktop.png",
  fullPage: true,
});
await page.getByRole("link", { name: "Connect Claude Code" }).click();
assert.equal(await page.getByLabel("Model alias").inputValue(), "super");
await page.setViewportSize({ width: 390, height: 844 });
assert.equal(
  await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth),
  false,
);
await page.screenshot({ path: ".private/superkey-mobile.png", fullPage: true });
await browser.close();
assert.deepEqual(errors, []);
writeFileSync(
  ".private/super-browser-result.json",
  JSON.stringify(
    {
      passed: true,
      total: 3013000000,
      used: 30,
      balance: 3012999970,
      polls,
      deduplicatedPools: 3,
      providers: 4,
      automaticFailover: true,
      clientFormats: 2,
      browserErrors: errors,
    },
    null,
    2,
  ),
);
console.log(
  "Super key browser acceptance passed: exact pooled total, shared-group deduplication, automatic fallback, cross-app usage, live refresh and mobile.",
);
