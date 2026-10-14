// The CLI, run the way the README says: a connector's output piped in, exit codes that a script
// can branch on (0 conforms, 3 conforms and BROKEN, 1 does not conform, 2 usage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "capture-connector.mjs");
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", input: input ?? "", cwd: tmpdir() });
const dir = () => mkdtempSync(join(tmpdir(), "capture-connector-cli-"));
const spec = (id) => ({ header: { sources: [{ type: "cloud_recording", service: "otter", recording_id: id, vendor_id: null }], aliases: [{ kind: "source-id", namespace: "cloud:otter", value: id }] } });

test("--help prints the contract and exits 0", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /CONNECTOR <name>: BROKEN <why>/);
});

test("check: a conforming run piped in exits 0", () => {
  const d = dir();
  mkdirSync(join(d, "staged"));
  writeFileSync(join(d, "staged", "a.json"), JSON.stringify(spec("a")));
  writeFileSync(join(d, "cp.json"), JSON.stringify({ last_sync: "2026-10-14T09:00:00Z", seen: { a: "2026-10-14T09:00:00Z" } }));
  const r = run(["check", "--name", "otter", "--staged", join(d, "staged"), "--checkpoint", join(d, "cp.json")], "pulling...\nCONNECTOR otter: new 1, staged 1\n");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^conforms$/m);
});

test("check: an honest BROKEN exits 3, a missing status line exits 1 and says why", () => {
  assert.equal(run(["check", "--name", "otter"], "CONNECTOR otter: BROKEN signed out\n").status, 3);
  const r = run(["check", "--name", "otter"], "nothing new\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PROBLEM no CONNECTOR line/);
});

test("check --json reports the same verdict as data", () => {
  const r = run(["check", "--json"], "CONNECTOR otter: new 2, staged 3\n");
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.conforms, false);
  assert.ok(j.problems.some((p) => /more than new/.test(p)));
});

test("check --output reads a file", () => {
  const d = dir();
  writeFileSync(join(d, "out.txt"), "CONNECTOR otter: new 0, staged 0\n");
  assert.equal(run(["check", "--output", join(d, "out.txt")]).status, 0);
});

test("status parses one line; config validates declarations", () => {
  assert.equal(run(["status", "CONNECTOR otter: new 1, staged 1"]).status, 0);
  assert.equal(run(["status", "CONNECTOR otter: BROKEN expired"]).status, 3);
  assert.equal(run(["status", "otter is fine"]).status, 1);
  const d = dir();
  writeFileSync(join(d, ".freedom.json"), JSON.stringify({ capture: { connectors: [{ name: "otter", skill: "otter-connector" }, { name: "x" }] } }));
  const r = run(["config", join(d, ".freedom.json")]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /otter\s+\(meetings\)/);
  assert.match(r.stdout, /PROBLEM/);
});

test("usage errors exit 2", () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(["nope"]).status, 2);
  assert.equal(run(["check", "--bogus"]).status, 2);
  assert.equal(run(["check", "--staged", "/no/such/file.json"], "CONNECTOR otter: new 0, staged 0").status, 2);
});
