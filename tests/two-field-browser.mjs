import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";

const fixture = fork(new URL("./two-field-server.mjs", import.meta.url), {
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let fixtureOutput = "";
fixture.stdout.on("data", (data) => {
  fixtureOutput += data;
});
fixture.stderr.on("data", (data) => {
  fixtureOutput += data;
});
let browser;
const errors = [];
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture readiness timed out")),
      15000,
    );
    fixture.once("message", (message) => {
      clearTimeout(timer);
      message.ready ? resolve() : reject(new Error("Fixture failed readiness"));
    });
    fixture.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture exited ${code}: ${fixtureOutput}`));
    });
  });
  const env = Object.fromEntries(
    readFileSync(".private/two-field-browser.env", "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://localhost:4012");
  await page.getByLabel("Setup token").fill(env.BOOTSTRAP_TOKEN);
  await page.getByLabel("Email address").fill("two-field-qa@example.com");
  await page.getByLabel(/^Password/).fill("two-field-fixture-password-123");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page
    .getByRole("heading", { name: "One key. Every provider." })
    .waitFor();
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.locator("input").count(), 2);
  assert.equal(await dialog.locator("select, textarea").count(), 0);
  const base = dialog.locator('input[type="url"]');
  const secret = dialog.locator('input[type="password"]');
  assert.equal(await base.count(), 1);
  assert.equal(await secret.count(), 1);
  await base.fill("https://router.bynara.id/v1");
  await secret.fill("fakekey-two-field-original");
  const connection = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/providers/connect") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Detect & connect", exact: true })
    .click();
  const response = await connection;
  assert.equal(response.status(), 201);
  const connected = await response.json();
  assert.equal(connected.provider.name, "NaraRouter");
  assert.equal(connected.provider.enabled, true);
  assert.deepEqual(connected.provider.models, ["free-coder"]);
  assert.ok(!JSON.stringify(connected).includes("fakekey-two-field-original"));
  await dialog.waitFor({ state: "hidden" });
  const overviewResponse = await page.request.get(
    "http://localhost:4012/api/admin/overview",
  );
  assert.equal(overviewResponse.status(), 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.superQuota.totalQuota, 1000);
  assert.equal(overview.superQuota.balanceQuota, 750);
  const aliases = await (
    await page.request.get("http://localhost:4012/api/admin/aliases")
  ).json();
  assert.ok(
    aliases.some(
      (alias) =>
        alias.name === "super" &&
        alias.targets.some(
          (target) =>
            target.providerId === connected.provider.id &&
            target.model === "free-coder",
        ),
    ),
  );
  const quota = page.getByRole("region", { name: "Super key quota" });
  await quota.getByText("750 tokens", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "Edit NaraRouter", exact: true })
    .first()
    .click();
  await dialog.waitFor();
  assert.equal(await dialog.locator("input").count(), 2);
  assert.equal(await dialog.locator("select, textarea").count(), 0);
  assert.equal(await secret.inputValue(), "");
  const summary = dialog.getByRole("region", {
    name: "Last detected provider details",
  });
  await summary.waitFor();
  assert.ok((await summary.innerText()).includes("Free models reported"));
  assert.ok(
    !(await page.locator("body").innerText()).includes(
      "fakekey-two-field-original",
    ),
  );
  const editResponse = page.waitForResponse(
    (r) =>
      r
        .url()
        .endsWith(`/api/admin/providers/${connected.provider.id}/connect`) &&
      r.request().method() === "PUT",
  );
  await dialog
    .getByRole("button", { name: /Detect & (connect|save)/i })
    .click();
  assert.equal((await editResponse).status(), 200);
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Edit NaraRouter", exact: true })
    .first()
    .click();
  await dialog.waitFor();
  await secret.fill("fakekey-two-field-replacement");
  const replacementResponse = page.waitForResponse(
    (r) =>
      r
        .url()
        .endsWith(`/api/admin/providers/${connected.provider.id}/connect`) &&
      r.request().method() === "PUT",
  );
  await dialog
    .getByRole("button", { name: /Detect & (connect|save)/i })
    .click();
  const replacement = await replacementResponse;
  assert.equal(replacement.status(), 200);
  const replacementBody = await replacement.json();
  assert.equal(replacementBody.provider.keySuffix, "ment");
  assert.ok(
    !JSON.stringify(replacementBody).includes("fakekey-two-field-replacement"),
  );
  await dialog.waitFor({ state: "hidden" });
  assert.ok(
    !(await page.locator("body").innerText()).includes(
      "fakekey-two-field-replacement",
    ),
  );
  await page.screenshot({
    path: ".private/two-field-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("http://localhost:4012/#connect");
  const desktopGuide = page.getByRole("region", {
    name: "Connect Claude Desktop",
  });
  await desktopGuide.waitFor();
  await desktopGuide
    .getByRole("button", { name: "Copy gateway base URL", exact: true })
    .waitFor();
  const settings = desktopGuide.locator(".desktop-setting");
  assert.match(
    await settings.filter({ hasText: "Gateway base URL" }).innerText(),
    /http:\/\/localhost:4012/,
  );
  assert.match(
    await settings.filter({ hasText: "Gateway auth scheme" }).innerText(),
    /x-api-key/,
  );
  assert.match(
    await settings.filter({ hasText: "Model discovery" }).innerText(),
    /On/,
  );
  assert.equal(
    await desktopGuide
      .getByLabel("Gateway alias for Claude Desktop")
      .inputValue(),
    "super",
  );
  assert.match(await desktopGuide.innerText(), /remove unavailable entries/);
  assert.match(
    await desktopGuide.innerText(),
    /does not turn another model into Claude/,
  );
  await desktopGuide
    .getByText("Other settings from Claude Desktop", { exact: true })
    .click();
  assert.match(
    await desktopGuide.innerText(),
    /Off unless every model in the route supports a 1M-token context/,
  );
  assert.match(
    await desktopGuide.innerText(),
    /pooled token balance does not increase context size/,
  );
  await page
    .getByRole("heading", { name: "Connect Claude Code", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".private/desktop-guide-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page
      .locator("body")
      .evaluate((element) => element.scrollWidth > innerWidth),
    false,
  );
  await page.screenshot({
    path: ".private/desktop-guide-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("http://localhost:4012/#overview");
  await page
    .getByRole("heading", { name: "One key. Every provider." })
    .waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page
      .locator("body")
      .evaluate((element) => element.scrollWidth > innerWidth),
    false,
  );
  await page.screenshot({
    path: ".private/two-field-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.locator("input").count(), 2);
  assert.equal(
    await page
      .locator("body")
      .evaluate((element) => element.scrollWidth > innerWidth),
    false,
  );
  await page.screenshot({
    path: ".private/two-field-mobile-dialog.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    ".private/two-field-browser-result.json",
    JSON.stringify(
      {
        passed: true,
        provider: connected.provider.name,
        inputCount: 2,
        automaticSuperRoute: true,
        totalQuota: 1000,
        balanceQuota: 750,
        editKeptMaskedKey: true,
        replacementKeyMasked: true,
        desktopGuide: {
          rootUrl: true,
          authScheme: "x-api-key",
          modelDiscovery: true,
          defaultModel: "super",
          conservativeContext: true,
        },
        mobileWidth: 375,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Two-field browser acceptance passed: discovery, quota, automatic super route, masked edit, desktop and 375px mobile.",
  );
} finally {
  await browser?.close();
  if (fixture.exitCode === null) {
    const exited = once(fixture, "exit");
    fixture.send("shutdown");
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            fixture.kill();
            reject(new Error("Fixture shutdown timed out"));
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
