import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
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
const VIDEO_PATTERN = /\.(mp4|webm|mov)$/;
const OVERSIZE_BYTES = 300 * 1024 * 1024;
const BATCH_FILES = ["song.opus", "clip.mp4", "song.flac", "03_Test_Artist_-_Night_Drive_(Official_Video)_[HD].mp4", "huge.mp3", "notes.txt"];
const BATCH_TIMEOUT_MS = 120_000;
const EXPECTED_ZIP_FILES = ["EasyStandard.dat", "ExpertPlusStandard.dat", "ExpertStandard.dat", "HardStandard.dat", "Info.dat", "NormalStandard.dat", "cover.png", "song.egg"];

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
  await page.waitForSelector("img.cover", { timeout: IMPORT_TIMEOUT_MS });
  const fieldValue = (label) => page.$eval(`::-p-xpath(//label[span[text()="${label}"]]/input)`, (node) => node.value);
  return {
    title: await fieldValue("Title"),
    artist: await fieldValue("Artist"),
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
  for (const fileName of expected.files) {
    await openNewProject(page);
    const started = Date.now();
    const result = await importFixture(page, fileName);
    const errorMs = Math.round(beatErrorMs(result.offsetMs, expected) * 10) / 10;
    const seconds = (Date.now() - started) / 1000;
    results.push({ fileName, ...result, errorMs, seconds });
    console.log(`format ${fileName}: "${result.title}" by "${result.artist}", ${result.bpm} BPM, offset ${result.offsetMs} ms, beat error ${errorMs} ms, ${result.summary}, ${seconds}s. ${result.gridFit}`);
  }
  const wrong = results.filter((result) => Math.abs(result.bpm - expected.bpm) > BPM_TOLERANCE || Math.abs(result.errorMs) > OFFSET_TOLERANCE_MS);
  if (wrong.length > 0) throw new Error(`beat grid wrong for ${wrong.map((result) => result.fileName).join(", ")}`);
  const videos = results.filter((result) => VIDEO_PATTERN.test(result.fileName));
  if (!videos.every((result) => result.summary.split(" ")[0].endsWith(".ogg"))) throw new Error("video imports did not keep only the sound as .ogg");
  const identityOf = (fileName) => results.find((result) => result.fileName === fileName);
  for (const check of [expected.tagged, expected.messyVideo]) {
    const found = identityOf(check.file);
    if (found.title !== check.title || found.artist !== check.artist) throw new Error(`${check.file} was named "${found.title}" by "${found.artist}", expected "${check.title}" by "${check.artist}"`);
  }
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
  const increasing = counts.Easy > 0 && counts.Easy < counts.Normal && counts.Normal < counts.Hard && counts.Hard < counts.Expert && counts.Expert < counts["Expert+"];
  if (!increasing) throw new Error(`auto-map counts are not increasing: ${JSON.stringify(counts)}`);
  await shoot("04-map");
  const timeline = await page.waitForSelector('[data-testid="timeline"]');
  const timelineBox = await timeline.boundingBox();
  await page.mouse.click(timelineBox.x + timelineBox.width / 3, timelineBox.y + 8);
  const before = await noteCount(page);
  await placeNoteFromGrid(page);
  await waitForNoteCount(page, before + 1);
  await expectText(page, "1 selected");
  await pressWithControl(page, "z");
  await waitForNoteCount(page, before);
  await expectText(page, "0 selected");
  await pressWithControl(page, "y");
  await waitForNoteCount(page, before + 1);
  console.log(`editor: placed a note from the grid (${before} to ${before + 1} notes), undo and redo worked`);
  await clickButton(page, "Play");
  await pause(1500);
  await shoot("05-playing");
  await clickButton(page, "Pause");
  await expectText(page, "All changes saved");
}

async function waitForZip(prefix = "") {
  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const zipName = readdirSync(DOWNLOAD_DIR).find((name) => name.startsWith(prefix) && name.endsWith(".zip"));
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
  const coverPath = join(DOWNLOAD_DIR, "cover.png");
  writeFileSync(coverPath, files["cover.png"]);
  const cover = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", coverPath], { encoding: "utf8" }).trim();
  if (cover !== "png,512,512") throw new Error(`cover.png is ${cover}`);
  if (!zipName.includes("(Neon Skyline - ")) throw new Error(`zip folder "${zipName}" does not carry the song's real name`);
  const songPath = join(DOWNLOAD_DIR, "song.egg");
  writeFileSync(songPath, files["song.egg"]);
  const song = probeCodec(songPath);
  if (song.codec !== "vorbis") throw new Error(`song.egg is ${song.codec}, not vorbis`);
  const difficultyCount = info._difficultyBeatmapSets[0]._difficultyBeatmaps.length;
  console.log(`export: ${zipName}, cover ${cover}, Info ${info._version} at ${info._beatsPerMinute} BPM, ${difficultyCount} difficulties, Expert v${expert.version} with ${expert.colorNotes.length} notes, song.egg vorbis ${song.durationSeconds.toFixed(2)}s`);
}

function writeBatchExtras() {
  writeFileSync(join(FIXTURE_DIR, "notes.txt"), "not a song");
  writeFileSync(join(FIXTURE_DIR, "huge.mp3"), "");
  truncateSync(join(FIXTURE_DIR, "huge.mp3"), OVERSIZE_BYTES);
}

async function batchRows(page) {
  return page.$$eval('[data-testid="batch-row"]', (rows) => rows.map((row) => ({
    status: row.className,
    label: row.querySelector(".label").textContent,
    message: row.querySelector(".message")?.textContent ?? "",
  })));
}

async function waitForBatchFinished(page, count) {
  await page.waitForFunction((expected) => {
    const node = document.querySelector('[data-testid="batch-progress"]');
    return node !== null && Number(node.dataset.total) === expected && Number(node.dataset.finished) === expected && node.dataset.running === "false";
  }, { timeout: BATCH_TIMEOUT_MS }, count);
}

async function batchCounts(page) {
  return page.$eval('[data-testid="batch-progress"]', (node) => ({
    made: Number(node.dataset.made), existing: Number(node.dataset.existing), failed: Number(node.dataset.failed), skipped: Number(node.dataset.skipped),
  }));
}

async function batchHeadline(page) {
  return page.$eval('[data-testid="batch-progress"]', (node) => node.textContent.trim());
}

function distinctProjectsIn(rows) {
  return new Set(rows.filter((row) => row.status.includes("existing")).map((row) => /"([^"]+)"/.exec(row.message)?.[1])).size;
}

async function expectAutoSelected(page, itemCount, label) {
  await page.waitForSelector('[data-testid="send-panel"]', { timeout: 10_000 });
  const text = await page.$eval('[data-testid="selected-count"]', (node) => node.textContent.trim());
  const selected = Number(/^(\d+) map/.exec(text)?.[1]);
  if (!(selected >= 1 && selected <= itemCount)) throw new Error(`${label}: expected the batch's maps to be selected on their own, panel says "${text}"`);
  console.log(`${label}: ${text} automatically, send panel shown`);
}

async function runBatchAgain(page) {
  await clickButton(page, "Clear finished");
  const input = await page.waitForSelector('[data-testid="batch-files"]');
  await input.uploadFile(...BATCH_FILES.map((name) => join(FIXTURE_DIR, name)));
  await waitForBatchFinished(page, BATCH_FILES.length);
  const counts = await batchCounts(page);
  if (counts.made !== 0 || counts.existing !== 4 || counts.failed !== 0 || counts.skipped !== 2) throw new Error(`a second run should find all 4 songs already made, got ${JSON.stringify(counts)}`);
  const rows = await batchRows(page);
  console.log(`batch again: ${await batchHeadline(page)}`);
  const text = await page.$eval('[data-testid="selected-count"]', (node) => node.textContent.trim());
  if (text !== `${distinctProjectsIn(rows)} maps selected`) throw new Error(`the second run should select each project it found once, panel says "${text}"`);
  console.log(`batch again: ${text} automatically`);
}

async function runDrop(page) {
  await clickButton(page, "Clear finished");
  const base64 = readFileSync(join(FIXTURE_DIR, "song.mp3")).toString("base64");
  await page.evaluate((encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped-song.mp3", { type: "audio/mpeg" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, base64);
  await waitForBatchFinished(page, 1);
  const counts = await batchCounts(page);
  if (counts.failed !== 0 || counts.made + counts.existing !== 1) throw new Error(`a dropped song should be picked up, got ${JSON.stringify(counts)}`);
  console.log(`drop: ${await batchHeadline(page)}`);
}

async function runQuestTab(page, shoot) {
  await clickButton(page, "On the Quest");
  await page.waitForSelector('[data-testid="quest-songs"]');
  const label = await page.$eval('[data-testid="read-quest-songs"]', (button) => button.textContent.trim());
  if (label !== "Connect the Quest and read its songs") throw new Error(`with no headset the viewer should offer to connect first, got "${label}"`);
  await shoot("09-quest-tab");
  await clickButton(page, "Make maps");
  await page.waitForSelector('[data-testid="batch-panel"]');
  console.log("quest tab: viewer offers to connect first, tabs switch back and forth");
}

async function expectQuestInstallConnectsFirst(page) {
  const label = await page.$eval('[data-testid="install-many-quest"]', (button) => ({ text: button.textContent.trim(), disabled: button.disabled }));
  if (label.text !== "Connect the Quest and install" || label.disabled) throw new Error(`with no headset the install button should offer to connect first, got ${JSON.stringify(label)}`);
  const status = await page.$eval('[data-testid="quest-status"]', (node) => node.textContent);
  if (!status.includes("Quest not connected")) throw new Error(`the Quest status should say it is not connected, got "${status}"`);
  console.log("quest: install offers to connect first, status says not connected");
}

async function runBatch(page, shoot) {
  writeBatchExtras();
  await page.goto(PREVIEW_URL);
  const input = await page.waitForSelector('[data-testid="batch-files"]');
  const started = Date.now();
  await input.uploadFile(...BATCH_FILES.map((name) => join(FIXTURE_DIR, name)));
  await waitForBatchFinished(page, BATCH_FILES.length);
  const rows = await batchRows(page);
  for (const row of rows) console.log(`batch ${row.status} ${row.label}: ${row.message}`);
  const counted = await batchCounts(page);
  console.log(`batch: ${await batchHeadline(page)} in ${(Date.now() - started) / 1000}s`);
  if (counted.made + counted.existing !== 4 || counted.failed !== 0 || counted.skipped !== 2) throw new Error(`batch result was ${JSON.stringify(counted)}`);
  await expectAutoSelected(page, rows.filter((row) => row.status.includes("done") || row.status.includes("existing")).length, "first batch");
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
  if (!byLabel["huge.mp3"].message.includes("256 MB")) throw new Error("the oversize file was not stopped by the size limit");
  if (!byLabel["notes.txt"].message.includes("not an audio or video file")) throw new Error("the text file was not rejected");
  if (!byLabel[BATCH_FILES[3]].message.startsWith("Test Artist - Night Drive,")) throw new Error(`the messy video was not renamed: ${byLabel[BATCH_FILES[3]].message}`);
  await shoot("07-batch");
  await runBatchAgain(page);
  await runDrop(page);
  const mappedCount = await page.$eval('[data-testid="project-list-bar"]', (bar) => Number(/Select all with notes \((\d+)\)/.exec(bar.textContent)[1]));
  await clickButton(page, `Select all with notes (${mappedCount})`);
  await expectText(page, `${mappedCount} maps selected`);
  await expectQuestInstallConnectsFirst(page);
  rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  await page.click('[data-testid="export-many-zip"]');
  await page.waitForSelector('[data-testid="export-many-result"]', { timeout: EXPORT_TIMEOUT_MS });
  const resultText = await page.$eval('[data-testid="export-many-result"]', (node) => node.textContent);
  await shoot("08-export-many");
  const zipName = await waitForZip("beatquest-studio-maps-");
  await pause(500);
  const files = unzipSync(new Uint8Array(readFileSync(join(DOWNLOAD_DIR, zipName))));
  const folders = [...new Set(Object.keys(files).map((path) => path.split("/")[0]))];
  if (folders.length !== mappedCount) throw new Error(`expected ${mappedCount} map folders, found ${folders.join(", ")}`);
  for (const folder of folders) {
    const info = JSON.parse(new TextDecoder().decode(files[`${folder}/Info.dat`]));
    const songPath = join(DOWNLOAD_DIR, "batch-song.egg");
    writeFileSync(songPath, files[`${folder}/song.egg`]);
    const song = probeCodec(songPath);
    if (song.codec !== "vorbis") throw new Error(`${folder}/song.egg is ${song.codec}`);
    if (!files[`${folder}/cover.png`]) throw new Error(`${folder} has no cover.png`);
    writeFileSync(join(DOWNLOAD_DIR, `cover-${folders.indexOf(folder)}.png`), files[`${folder}/cover.png`]);
    const difficulties = info._difficultyBeatmapSets[0]._difficultyBeatmaps.map((entry) => entry._difficulty).join("/");
    console.log(`export many: ${folder} at ${info._beatsPerMinute} BPM, ${difficulties}, song.egg vorbis ${song.durationSeconds.toFixed(1)}s`);
  }
  console.log(`export many: ${resultText}`);
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
    await runBatch(page, shoot);
    await runQuestTab(page, shoot);
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
