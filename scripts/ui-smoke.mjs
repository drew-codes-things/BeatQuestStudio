import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import puppeteer from "puppeteer-core";

const PREVIEW_URL = "http://127.0.0.1:4173/";
const CHROME_PATH = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const SCREENSHOT_DIR = resolve(process.env.SMOKE_SCREENSHOT_DIR ?? "smoke-screens");
const FIXTURE_DIR = join(SCREENSHOT_DIR, "fixtures");
const DOWNLOAD_DIR = join(SCREENSHOT_DIR, "downloads");
const STARTUP_TIMEOUT_MS = 20_000;
const IMPORT_TIMEOUT_MS = 60_000;
const EXPORT_TIMEOUT_MS = 60_000;
const BPM_TOLERANCE = 0.05;
const OFFSET_TOLERANCE_MS = 5;
const GRID_CELL_SIZE = 76;
const FORMATS = ["song.wav", "song.mp3", "song.m4a", "song.opus", "song.ogg", "song.flac", "clip.mp4", "clip.webm", "clip.mov"];
const EXPECTED_ZIP_FILES = ["EasyStandard.dat", "ExpertStandard.dat", "HardStandard.dat", "Info.dat", "NormalStandard.dat", "cover.png", "song.egg"];

const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

function startPreviewServer() {
  const server = spawn("node_modules/.bin/vite", ["preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("vite preview did not start in time")), STARTUP_TIMEOUT_MS);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("4173")) {
        clearTimeout(timer);
        resolvePromise(server);
      }
    });
    server.on("exit", (code) => reject(new Error(`vite preview exited early with code ${code}`)));
  });
}

function makeFixtures() {
  const output = execFileSync("node_modules/.bin/vite-node", ["scripts/make-fixtures.ts", FIXTURE_DIR], { encoding: "utf8" });
  return JSON.parse(output.trim().split("\n").pop());
}

async function clickButton(page, label) {
  const button = await page.waitForSelector(`::-p-xpath(//button[normalize-space()="${label}"])`, { timeout: 5_000 });
  await button.click();
}

async function expectText(page, text, timeout = 5_000) {
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout }, text);
}

async function expectNoText(page, text) {
  await page.waitForFunction((unexpected) => !document.body.innerText.includes(unexpected), { timeout: 5_000 }, text);
}

async function projectNames(page) {
  return page.$$eval(".project-card .name", (nodes) => nodes.map((node) => node.textContent));
}

async function runDashboard(page, shoot) {
  await page.goto(PREVIEW_URL);
  await expectText(page, "No projects yet");
  await shoot("01-empty");
  await clickButton(page, "New project");
  await expectText(page, "Song file");
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
  await page.reload();
  await expectText(page, "Smoke Test Map (copy)");
  const copyCard = await page.waitForSelector("::-p-xpath(//div[contains(@class,'project-card')][.//div[@class='name' and text()='Smoke Test Map (copy)']])");
  await (await copyCard.waitForSelector("::-p-xpath(.//button[normalize-space()='Delete'])")).click();
  await expectText(page, "Click again to delete");
  await (await copyCard.waitForSelector("::-p-xpath(.//button[normalize-space()='Click again to delete'])")).click();
  await expectNoText(page, "Smoke Test Map (copy)");
  const remaining = await projectNames(page);
  if (remaining.length !== 1 || remaining[0] !== "Smoke Test Map") throw new Error(`expected only "Smoke Test Map" to remain, found ${JSON.stringify(remaining)}`);
  console.log("dashboard: create, rename, back up, duplicate, reload and delete worked");
}

async function openNewProject(page) {
  await page.goto(PREVIEW_URL);
  await clickButton(page, "New project");
  await expectText(page, "Song file");
}

async function importFixture(page, fileName) {
  const input = await page.waitForSelector('[data-testid="import-song"]');
  await input.uploadFile(join(FIXTURE_DIR, fileName));
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-testid="song-summary"]');
    const failed = document.querySelector('.error-banner[role="alert"]');
    const busy = document.querySelector('.info-banner[role="status"]');
    return failed || (summary && !busy);
  }, { timeout: IMPORT_TIMEOUT_MS });
  const failure = await page.$eval('.error-banner[role="alert"]', (node) => node.textContent).catch(() => null);
  if (failure) throw new Error(`${fileName}: ${failure}`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="grid-fit"]')?.textContent.includes("not measured"), { timeout: IMPORT_TIMEOUT_MS });
  return {
    bpm: Number(await page.$eval('[data-testid="bpm"]', (node) => node.value)),
    offsetMs: Number(await page.$eval('[data-testid="offset"]', (node) => node.value)),
    summary: await page.$eval('[data-testid="song-summary"]', (node) => node.textContent),
    gridFit: await page.$eval('[data-testid="grid-fit"]', (node) => node.textContent),
  };
}

function beatErrorMs(offsetMs, expected) {
  const halfBarMs = (2 * 60_000) / expected.bpm;
  const difference = offsetMs - expected.downbeatSeconds * 1000;
  return ((difference % halfBarMs) + halfBarMs * 1.5) % halfBarMs - halfBarMs / 2;
}

async function runFormats(page, expected) {
  const results = [];
  for (const fileName of FORMATS) {
    await openNewProject(page);
    const started = Date.now();
    const result = await importFixture(page, fileName);
    const errorMs = Math.round(beatErrorMs(result.offsetMs, expected) * 10) / 10;
    const seconds = (Date.now() - started) / 1000;
    results.push({ fileName, ...result, errorMs, seconds });
    console.log(`format ${fileName}: ${result.bpm} BPM, offset ${result.offsetMs} ms, beat error ${errorMs} ms, ${result.summary}, ${seconds}s. ${result.gridFit}`);
  }
  const wrong = results.filter((result) => Math.abs(result.bpm - expected.bpm) > BPM_TOLERANCE || Math.abs(result.errorMs) > OFFSET_TOLERANCE_MS);
  if (wrong.length > 0) throw new Error(`beat grid wrong for ${wrong.map((result) => result.fileName).join(", ")}`);
  const videos = results.filter((result) => result.fileName.startsWith("clip."));
  if (!videos.every((result) => result.summary.startsWith("clip.ogg"))) throw new Error("video imports did not keep only the sound as clip.ogg");
}

async function difficultyCounts(page) {
  return page.$$eval(".difficulty-tabs .tab", (tabs) => Object.fromEntries(tabs.map((tab) => [tab.firstChild.textContent.trim(), Number(tab.querySelector(".count").textContent)])));
}

async function noteCount(page) {
  const text = await page.$eval(".status-line", (node) => node.textContent);
  return Number(/(\d+) notes/.exec(text)[1]);
}

async function waitForNoteCount(page, count) {
  await page.waitForFunction((target) => /(\d+) notes/.exec(document.querySelector(".status-line").textContent)?.[1] === String(target), { timeout: 3_000 }, count);
}

async function pressWithControl(page, key) {
  await page.keyboard.down("Control");
  await page.keyboard.press(key);
  await page.keyboard.up("Control");
}

async function placeNoteFromGrid(page) {
  const grid = await page.waitForSelector('[data-testid="grid-panel"]');
  const box = await grid.boundingBox();
  const cellCentreX = box.x + GRID_CELL_SIZE / 2;
  const cellCentreY = box.y + GRID_CELL_SIZE * 2.5;
  await page.mouse.move(cellCentreX, cellCentreY - 20);
  await page.mouse.down();
  await page.mouse.move(cellCentreX, cellCentreY + 20, { steps: 4 });
  await page.mouse.up();
}

async function runEditorFlow(page, shoot) {
  await openNewProject(page);
  await importFixture(page, "song.mp3");
  await shoot("02-song");
  await clickButton(page, "Auto-map");
  await clickButton(page, "Generate");
  await expectText(page, "Drafted", 20_000);
  await shoot("03-automap");
  await clickButton(page, "Map");
  const counts = await difficultyCounts(page);
  console.log(`auto-map counts ${JSON.stringify(counts)}`);
  const increasing = counts.Easy > 0 && counts.Easy < counts.Normal && counts.Normal < counts.Hard && counts.Hard < counts.Expert;
  if (!increasing) throw new Error(`auto-map counts are not increasing: ${JSON.stringify(counts)}`);
  await shoot("04-map");
  const timeline = await page.waitForSelector('[data-testid="timeline"]');
  const timelineBox = await timeline.boundingBox();
  await page.mouse.click(timelineBox.x + timelineBox.width / 3, timelineBox.y + 8);
  const before = await noteCount(page);
  await placeNoteFromGrid(page);
  await waitForNoteCount(page, before + 1);
  await pressWithControl(page, "z");
  await waitForNoteCount(page, before);
  await pressWithControl(page, "y");
  await waitForNoteCount(page, before + 1);
  console.log(`editor: placed a note from the grid (${before} to ${before + 1} notes), undo and redo worked`);
  await clickButton(page, "Play");
  await pause(1500);
  await shoot("05-playing");
  await clickButton(page, "Pause");
  await expectText(page, "All changes saved");
}

async function waitForZip() {
  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const zipName = readdirSync(DOWNLOAD_DIR).find((name) => name.endsWith(".zip"));
    if (zipName) return zipName;
    await pause(200);
  }
  throw new Error("the zip was not downloaded");
}

function probeCodec(path) {
  const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:format=duration", "-of", "json", path], { encoding: "utf8" });
  const probed = JSON.parse(output);
  return { codec: probed.streams?.[0]?.codec_name, durationSeconds: Number(probed.format?.duration) };
}

async function runExport(page, shoot, browser) {
  rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const session = await browser.target().createCDPSession();
  await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOAD_DIR });
  await clickButton(page, "Check & export");
  await page.waitForSelector('[data-testid="download-zip"]');
  await shoot("06-check");
  await page.click('[data-testid="download-zip"]');
  await page.waitForSelector('[data-testid="export-result"]', { timeout: EXPORT_TIMEOUT_MS });
  const zipName = await waitForZip();
  await pause(500);
  const files = unzipSync(new Uint8Array(readFileSync(join(DOWNLOAD_DIR, zipName))));
  const names = Object.keys(files).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_ZIP_FILES)) throw new Error(`zip holds ${names.join(", ")}`);
  const info = JSON.parse(new TextDecoder().decode(files["Info.dat"]));
  const expert = JSON.parse(new TextDecoder().decode(files["ExpertStandard.dat"]));
  const songPath = join(DOWNLOAD_DIR, "song.egg");
  writeFileSync(songPath, files["song.egg"]);
  const song = probeCodec(songPath);
  if (song.codec !== "vorbis") throw new Error(`song.egg is ${song.codec}, not vorbis`);
  const difficultyCount = info._difficultyBeatmapSets[0]._difficultyBeatmaps.length;
  console.log(`export: ${zipName}, Info ${info._version} at ${info._beatsPerMinute} BPM, ${difficultyCount} difficulties, Expert v${expert.version} with ${expert.colorNotes.length} notes, song.egg vorbis ${song.durationSeconds.toFixed(2)}s`);
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const expected = makeFixtures();
  const server = await startPreviewServer();
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"] });
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) pageErrors.push(`${response.status()} ${response.url()}`); });
    const shoot = (name) => page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
    await runDashboard(page, shoot);
    await runFormats(page, expected);
    await runEditorFlow(page, shoot);
    await runExport(page, shoot, browser);
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
