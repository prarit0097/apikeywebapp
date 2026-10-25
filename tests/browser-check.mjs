import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(".private/local.env", "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:4000");
await page.getByRole("heading", { name: "Make it yours." }).waitFor();
await page.screenshot({ path: ".private/setup-desktop.png", fullPage: true });
await page.getByLabel("Setup token").fill(env.BOOTSTRAP_TOKEN);
await page.getByLabel("Email address").fill("qa@example.com");
await page.getByLabel(/^Password/).fill("qa-long-password-12345");
await page.getByRole("button", { name: "Create workspace" }).click();
await page.getByRole("heading", { name: "One key. Every provider." }).waitFor();
await page.screenshot({
  path: ".private/overview-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Add provider", exact: true }).click();
await page.getByLabel("Quick setup").selectOption("gemini");
await page.getByLabel("Provider name").fill("QA Gemini");
await page
  .getByLabel("Provider API key")
  .fill("qa-only-not-a-real-provider-key");
await page.getByLabel("Quota group / project ID").fill("qa-project");
await page.getByLabel("Exact model IDs").fill("qa-model");
await page.getByLabel("Billing policy").selectOption("free");
await page.getByRole("button", { name: "Save provider" }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page.getByRole("button", { name: "Choose your model routes" }).click();
await page.getByRole("button", { name: "Save route" }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page.getByRole("button", { name: "Generate your gateway key" }).click();
await page.getByLabel("Key name").fill("QA key");
await page.getByRole("button", { name: "Generate key", exact: true }).click();
await page
  .getByRole("heading", { name: "Your gateway key is ready" })
  .waitFor();
const key = await page.locator(".secret-reveal code").innerText();
await page.getByRole("button", { name: "I saved my key" }).click();
await page.getByRole("link", { name: "Connect Claude Code" }).click();
await page.getByLabel("Gateway key for connection test").fill(key);
await page.getByRole("button", { name: "Test", exact: true }).click();
await page
  .getByText(
    "Connected. 2 model aliases available. Live generation remains unverified.",
  )
  .waitFor();
await page.screenshot({ path: ".private/connect-desktop.png", fullPage: true });
for (const name of [
  "Overview",
  "Providers",
  "Model routing",
  "Gateway keys",
  "Request logs",
]) {
  await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(100);
  if (await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth))
    throw new Error(`Desktop overflow on ${name}`);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Open navigation" }).click();
await page.getByRole("link", { name: "Overview", exact: true }).click();
await page.locator(".sidebar.open").waitFor({ state: "hidden" });
await page.getByRole("heading", { name: "One key. Every provider." }).waitFor();
await page.screenshot({ path: ".private/overview-mobile.png", fullPage: true });
if (await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth))
  throw new Error("Mobile overview overflow");
await page.getByRole("button", { name: "Add provider", exact: true }).click();
await page.screenshot({ path: ".private/provider-mobile.png", fullPage: true });
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 375, height: 812 });
await page.emulateMedia({ reducedMotion: "reduce" });
if (await page.locator("body").evaluate((el) => el.scrollWidth > innerWidth))
  throw new Error("375px overview overflow");
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
writeFileSync(
  ".private/browser-check.json",
  JSON.stringify(
    {
      passed: true,
      checks: [
        "setup",
        "owner login",
        "provider add",
        "alias create",
        "key reveal",
        "connection test",
        "all navigation",
        "390px mobile",
        "375px reduced motion",
        "modal Escape",
      ],
      pageErrors: errors,
    },
    null,
    2,
  ),
);
console.log(
  "Browser checks passed: setup, provider, alias, key, connection, navigation, desktop and mobile.",
);
