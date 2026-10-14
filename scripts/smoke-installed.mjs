#!/usr/bin/env node
// Prove the PACKED package works the way the README says, from outside this repo: npm pack,
// install the tarball into an empty folder, import the library and run the CLI from there.
// Run by CI after the tests; passing tests prove the parts, this proves the thing installs.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "capture-connector-pack-"));
const [{ filename }] = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", out], { cwd: ROOT, encoding: "utf8" }));
const app = mkdtempSync(join(tmpdir(), "capture-connector-app-"));
writeFileSync(join(app, "package.json"), JSON.stringify({ name: "smoke", version: "0.0.0", type: "module" }));
execFileSync("npm", ["install", "--no-audit", "--no-fund", join(out, filename)], { cwd: app, stdio: "inherit" });
const fail = (m) => { console.error(`SMOKE FAILED: ${m}`); process.exit(1); };

const lib = spawnSync(process.execPath, ["--input-type=module", "-e",
  'import { formatStatus, checkRun } from "@supersuit/capture-connector"; const r = checkRun({ output: formatStatus("otter", { new: 0, staged: 0 }) }); if (!r.conforms) process.exit(1); console.log("import ok");'],
  { cwd: app, encoding: "utf8" });
if (lib.status !== 0) fail(`library import: ${lib.stderr}`);
const bin = join(app, "node_modules", ".bin", "capture-connector");
const ok = spawnSync(bin, ["check", "--name", "otter"], { cwd: app, input: "CONNECTOR otter: new 1, staged 1\n", encoding: "utf8" });
if (ok.status !== 0) fail(`check on a conforming run exited ${ok.status}: ${ok.stdout}${ok.stderr}`);
const broken = spawnSync(bin, ["check", "--name", "otter"], { cwd: app, input: "nothing new\n", encoding: "utf8" });
if (broken.status !== 1) fail(`check on a run with no status line exited ${broken.status}`);
const help = spawnSync(bin, ["--help"], { cwd: app, encoding: "utf8" });
if (help.status !== 0 || !/CONNECTOR <name>: BROKEN/.test(help.stdout)) fail("--help");
console.log(`smoke ok: ${filename} installs, imports, and its CLI keeps the contract`);
