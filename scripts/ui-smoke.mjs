import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const PREVIEW_URL = "http://127.0.0.1:4173/";
const CHROME_PATH = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const SCREENSHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR ?? "smoke-screens";
const STARTUP_TIMEOUT_MS = 20_000;

function startPreviewServer() {
  const server = spawn("node_modules/.bin/vite", ["preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite preview did not start in time")), STARTUP_TIMEOUT_MS);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("4173")) {
        clearTimeout(timer);
        resolve(server);
      }
    });
    server.on("exit", (code) => reject(new Error(`vite preview exited early with code ${code}`)));
  });
}

async function clickButton(page, label) {
  const button = await page.waitForSelector(`::-p-xpath(//button[normalize-space()="${label}"])`, { timeout: 5_000 });
  await button.click();
}

async function expectText(page, text) {
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 5_000 }, text);
}

async function expectNoText(page, text) {
  await page.waitForFunction((unexpected) => !document.body.innerText.includes(unexpected), { timeout: 5_000 }, text);
}

async function projectNames(page) {
  return page.$$eval(".project-card .name", (nodes) => nodes.map((node) => node.textContent));
}

async function runSmoke(page, shoot) {
  await page.goto(PREVIEW_URL);
  await expectText(page, "No projects yet");
  await shoot("01-empty");

  await clickButton(page, "New project");
  await expectText(page, "Back to projects");
  await expectText(page, "Expert");
  await shoot("02-project");

  await clickButton(page, "Back to projects");
  await expectText(page, "Untitled map");

  await clickButton(page, "Rename");
  const nameInput = await page.waitForSelector('input[aria-label="Project name"]');
  await nameInput.click({ count: 3 });
  await nameInput.type("Smoke Test Map");
  await clickButton(page, "Save");
  await expectText(page, "Smoke Test Map");

  await clickButton(page, "Back up");
  await clickButton(page, "Backups");
  await expectText(page, "manual");

  await clickButton(page, "Duplicate");
  await expectText(page, "Smoke Test Map (copy)");
  await shoot("03-dashboard");

  await page.reload();
  await expectText(page, "Smoke Test Map (copy)");

  const copyCard = await page.waitForSelector("::-p-xpath(//div[contains(@class,'project-card')][.//div[@class='name' and text()='Smoke Test Map (copy)']])");
  const deleteButton = await copyCard.waitForSelector("::-p-xpath(.//button[normalize-space()='Delete'])");
  await deleteButton.click();
  await expectText(page, "Click again to delete");
  await shoot("04-delete-armed");
  const armedButton = await copyCard.waitForSelector("::-p-xpath(.//button[normalize-space()='Click again to delete'])");
  await armedButton.click();
  await expectNoText(page, "Smoke Test Map (copy)");

  const remaining = await projectNames(page);
  if (remaining.length !== 1 || remaining[0] !== "Smoke Test Map") throw new Error(`expected only "Smoke Test Map" to remain, found ${JSON.stringify(remaining)}`);
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const server = await startPreviewServer();
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) pageErrors.push(`${response.status()} ${response.url()}`); });
    const shoot = (name) => page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
    await runSmoke(page, shoot);
    if (pageErrors.length > 0) throw new Error(`page reported errors:\n${pageErrors.join("\n")}`);
    console.log("ui smoke passed");
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(`ui smoke failed: ${error.message}`);
  process.exit(1);
});
