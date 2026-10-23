import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareWebWorkspace, webEnvironment } from "../../src/web/environment.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const paths = await prepareWebWorkspace(workspace);
const environment = webEnvironment(workspace);
const requireWigolo = createRequire(await realpath(join(workspace, "node_modules/wigolo/package.json")));
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await operation(); }
    catch (error) { last = error; if (attempt < 3) console.warn(`Upstream download failed; retry ${attempt}/2`); }
  }
  throw last;
}
async function run(command: string, args: string[], cwd = workspace, capture = false): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env: environment, windowsHide: true, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill();
      reject(new Error(`${command} timed out; check network access and retry pnpm setup:web`));
    }, 15 * 60_000);
    let output = "", errors = "";
    child.stdout?.on("data", (chunk) => { output += chunk; }); child.stderr?.on("data", (chunk) => { errors += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", (code) => { clearTimeout(timer); code === 0 ? done(output) : reject(new Error(`${command} exited ${code}: ${errors.slice(-2000)}`)); });
  });
}
async function ensureSqlite() {
  const database = requireWigolo("better-sqlite3");
  try { const db = new database(":memory:"); db.close(); return; } catch { /* Repair a failed native prebuild download without requiring a compiler. */ }
  const packagePath = requireWigolo.resolve("better-sqlite3/package.json");
  const target = dirname(packagePath);
  if (!resolve(target).startsWith(resolve(workspace, "node_modules") + sep)) throw new Error("Native package must be inside workspace node_modules");
  const version = JSON.parse(await readFile(packagePath, "utf8")).version;
  const name = `better-sqlite3-v${version}-node-v${process.versions.modules}-${process.platform}-${process.arch}.tar.gz`;
  const release = await retry(async () => {
    const response = await fetch(`https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v${version}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Native release metadata HTTP ${response.status}`);
    return await response.json() as { assets: Array<{ name: string; browser_download_url: string; digest?: string }> };
  });
  const asset = release.assets.find((item) => item.name === name);
  if (!asset) throw new Error(`No upstream prebuilt ${name}; install supported Node.js and reinstall dependencies`);
  console.log(`Repairing native SQLite from upstream release: ${name}`);
  const downloads = join(paths.data, "downloads"); await mkdir(downloads, { recursive: true });
  const archive = join(downloads, name);
  const matchesDigest = (bytes: Buffer) => asset.digest?.startsWith("sha256:") && createHash("sha256").update(bytes).digest("hex") === asset.digest.slice(7);
  let bytes: Buffer | undefined;
  try { const cached = await readFile(archive); if (matchesDigest(cached)) { bytes = cached; console.log("Using verified workspace download cache"); } } catch { /* No verified cache yet. */ }
  bytes ??= await retry(async () => {
    const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
    if (!download.ok) throw new Error(`Native release download HTTP ${download.status}`);
    const downloaded = Buffer.from(await download.arrayBuffer());
    if (asset.digest?.startsWith("sha256:") && !matchesDigest(downloaded)) throw new Error("Native release SHA256 mismatch");
    return downloaded;
  });
  await writeFile(archive, bytes);
  const members = (await run("tar", ["-tzf", archive], workspace, true)).trim().split(/\r?\n/);
  if (members.some((member) => !/^build\/(?:Release\/)?(?:better_sqlite3\.node)?\/?$/.test(member))) throw new Error("Unexpected native archive contents");
  await run("tar", ["-xzf", archive, "-C", target]);
  const db = new database(":memory:"); db.close();
}

console.log("Checking workspace SQLite runtime...");
await ensureSqlite();
if (process.argv.includes("--browser")) {
  const playwrightPackage = requireWigolo.resolve("playwright/package.json");
  console.log(`Installing optional Chromium into ${paths.browsers} (large first-run download)...`);
  await run(process.execPath, [join(dirname(playwrightPackage), "cli.js"), "install", "chromium"]);
  Object.assign(process.env, environment);
  const { chromium } = requireWigolo("playwright");
  const browser = await chromium.launch({ headless: true });
  try { const page = await browser.newPage(); await page.setContent("<title>Pi Web Setup</title>"); if (await page.title() !== "Pi Web Setup") throw new Error("Browser check failed"); }
  finally { await browser.close(); }
  console.log("Optional Chromium launch check: PASS");
}
console.log(`Web setup ready: wigolo + SQLite; data stays in ${paths.root}`);
console.log("Static search/fetch needs no browser download. For JavaScript pages: pnpm setup:web --browser");
