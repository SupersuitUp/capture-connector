// The contract, pinned. Each test names the rule it holds; each was seen to fail with that rule
// broken in src/index.mjs before it was trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS, NAME_PATTERN, SKILL_PATTERN, nameProblem, validateDeclarations, formatStatus, formatBroken,
  parseStatusLine, checkOutput, validateStagedSpec, validateCheckpoint, checkRun,
} from "../src/index.mjs";

const spec = (id, name = "notion-meetings", extra = {}) => ({
  header: {
    sources: [{ id: "s1", type: "cloud_recording", service: name, recording_id: id, vendor_id: null }],
    aliases: [{ kind: "source-id", namespace: `cloud:${name}`, value: id }],
    ...extra,
  },
});
const cp = (ids) => ({ last_sync: "2026-10-14T09:00:00Z", seen: Object.fromEntries(ids.map((i) => [i, "2026-10-14T09:00:00Z"])) });

// --- declarations (ported from Freedom's freedom-capture-connectors.mjs tests) ---

test("no declaration is an empty list, not an error", () => {
  assert.deepEqual(validateDeclarations(undefined), { connectors: [], problems: [] });
});

test("a declaration that is not a list is one named problem", () => {
  assert.deepEqual(validateDeclarations({}), { connectors: [], problems: ["capture.connectors is not a list"] });
});

test("valid entries come back with kind defaulting to meetings; every bad one is a named problem", () => {
  const r = validateDeclarations([
    { name: "notion-meetings", skill: "notion-meetings-connector", description: "Notion AI meeting notes" },
    { name: "Bad Name", skill: "x" },
    { name: "no-skill" },
    { name: "notion-meetings", skill: "dup" },
    { name: "odd-kind", skill: "y", kind: "videos" },
    "not an object",
  ]);
  assert.equal(r.connectors.length, 1);
  assert.deepEqual(r.connectors[0], { name: "notion-meetings", skill: "notion-meetings-connector", kind: "meetings", description: "Notion AI meeting notes" });
  assert.equal(r.problems.length, 5);
  assert.ok(r.problems.some((p) => /declared twice/.test(p)));
  assert.ok(r.problems.some((p) => /no skill named/.test(p)));
  assert.ok(r.problems.some((p) => /lowercase letters/.test(p)));
  assert.ok(r.problems.some((p) => /kind must be one of meetings, messages, documents/.test(p)));
  assert.ok(r.problems.some((p) => /\[5\] is not an object/.test(p)));
});

test("names and skill names are plain folder-safe words, never paths", () => {
  assert.deepEqual([...KINDS], ["meetings", "messages", "documents"]);
  for (const ok of ["otter", "notion-meetings", "a1"]) assert.ok(NAME_PATTERN.test(ok), ok);
  for (const bad of ["Otter", "-x", "x", "a b", "../x", "a/b"]) assert.ok(!NAME_PATTERN.test(bad), bad);
  for (const bad of ["../escape", "a/b", "/abs", "Has Space", ".."]) assert.ok(!SKILL_PATTERN.test(bad), bad);
  assert.equal(nameProblem("otter"), null);
  assert.match(nameProblem("Not OK"), /lowercase/);
});

// --- rule 4: the status line ---

test("the status line round-trips: what formatStatus and formatBroken write, parseStatusLine reads", () => {
  assert.equal(formatStatus("otter", { new: 3, staged: 2 }), "CONNECTOR otter: new 3, staged 2");
  assert.deepEqual(parseStatusLine(formatStatus("otter", { new: 3, staged: 2 })), { name: "otter", status: "ok", new: 3, staged: 2 });
  assert.equal(formatBroken("otter", "signed out\n of Otter"), "CONNECTOR otter: BROKEN signed out of Otter");
  assert.deepEqual(parseStatusLine(formatBroken("otter", "token expired")), { name: "otter", status: "broken", why: "token expired" });
});

test("anything else is not a status line", () => {
  for (const bad of ["CONNECTOR otter: new 3", "CONNECTOR otter: 0", "connector otter: new 1, staged 1", "CONNECTOR Otter: new 1, staged 1", "CONNECTOR otter: new -1, staged 0", ""]) {
    assert.equal(parseStatusLine(bad), null, bad);
  }
});

test("a run that ends without a status line is a problem, never a quiet zero", () => {
  const r = checkOutput("fetched nothing\n");
  assert.equal(r.status, null);
  assert.match(r.problems[0], /no CONNECTOR line/);
});

test("exactly one status line, and it is the last thing printed", () => {
  assert.deepEqual(checkOutput("working...\nCONNECTOR otter: new 1, staged 1\n").problems, []);
  assert.ok(checkOutput("CONNECTOR otter: new 1, staged 1\nCONNECTOR otter: new 1, staged 1").problems.some((p) => /exactly one/.test(p)));
  assert.ok(checkOutput("CONNECTOR otter: new 1, staged 1\ndone").problems.some((p) => /not the last line/.test(p)));
});

test("the status line names this connector, and a malformed one is named as malformed", () => {
  assert.ok(checkOutput("CONNECTOR fireflies: new 1, staged 1", { name: "otter" }).problems.some((p) => /names "fireflies", not "otter"/.test(p)));
  assert.ok(checkOutput("CONNECTOR otter: 0").problems.some((p) => /malformed status line/.test(p)));
});

test("BROKEN says why, and staged is never more than new", () => {
  assert.ok(checkOutput("CONNECTOR otter: BROKEN").problems.some((p) => /BROKEN with no reason/.test(p)));
  assert.deepEqual(checkOutput("CONNECTOR otter: BROKEN token expired").problems, []);
  assert.ok(checkOutput("CONNECTOR otter: new 1, staged 2").problems.some((p) => /more than new/.test(p)));
});

// --- rule 1: stage, never file ---

test("a staged item carries a cloud_recording source for this connector, with its own id and the matching alias", () => {
  assert.deepEqual(validateStagedSpec(spec("rec-1"), { name: "notion-meetings" }), { recordingId: "rec-1", problems: [] });
  assert.match(validateStagedSpec({}).problems[0], /no header/);
  assert.match(validateStagedSpec(spec("rec-1", "otter"), { name: "notion-meetings" }).problems[0], /no source with type "cloud_recording" and service "notion-meetings"/);
  const noId = spec("rec-1"); delete noId.header.sources[0].recording_id;
  assert.ok(validateStagedSpec(noId, { name: "notion-meetings" }).problems.some((p) => /no recording_id/.test(p)));
  const vendor = spec("rec-1"); vendor.header.sources[0].vendor_id = "v";
  assert.ok(validateStagedSpec(vendor, { name: "notion-meetings" }).problems.some((p) => /never vendor_id/.test(p)));
  const noAlias = spec("rec-1"); noAlias.header.aliases = [];
  assert.ok(validateStagedSpec(noAlias, { name: "notion-meetings" }).problems.some((p) => /no source-id alias/.test(p)));
  const wrongAlias = spec("rec-1"); wrongAlias.header.aliases[0].value = "rec-2";
  assert.ok(validateStagedSpec(wrongAlias, { name: "notion-meetings" }).problems.some((p) => /no source-id alias/.test(p)));
  const two = spec("rec-1"); two.header.sources.push({ ...two.header.sources[0], id: "s2" });
  assert.ok(validateStagedSpec(two, { name: "notion-meetings" }).problems.some((p) => /one item is one recording/.test(p)));
});

// --- the checkpoint, and rules 2 and 3 ---

test("a checkpoint is last_sync plus seen, every value an ISO timestamp", () => {
  assert.deepEqual(validateCheckpoint(cp(["a"])).problems, []);
  assert.ok(validateCheckpoint({ seen: {} }).problems.some((p) => /last_sync/.test(p)));
  assert.ok(validateCheckpoint({ last_sync: "2026-10-14T09:00:00Z", seen: { a: "yesterday" } }).problems.some((p) => /seen\["a"\]/.test(p)));
  assert.ok(validateCheckpoint(null).problems.length);
});

test("a conforming run conforms", () => {
  const r = checkRun({ output: "CONNECTOR notion-meetings: new 2, staged 2", name: "notion-meetings", staged: [spec("a"), spec("b")], checkpoint: cp(["a", "b"]), previousCheckpoint: cp(["z"]) });
  assert.deepEqual(r, { conforms: true, status: "ok", problems: [] });
});

test("an honest BROKEN run conforms, and says it was broken", () => {
  assert.deepEqual(checkRun({ output: "CONNECTOR otter: BROKEN signed out", staged: [] }), { conforms: true, status: "broken", problems: [] });
});

test("rule 2: an id the previous checkpoint had seen, or one staged twice, is a dedupe failure", () => {
  assert.ok(checkRun({ output: "CONNECTOR notion-meetings: new 1, staged 1", name: "notion-meetings", staged: [spec("a")], previousCheckpoint: cp(["a"]) }).problems.some((p) => /already in the previous checkpoint/.test(p)));
  assert.ok(checkRun({ output: "CONNECTOR notion-meetings: new 2, staged 2", name: "notion-meetings", staged: [spec("a"), spec("a")] }).problems.some((p) => /staged twice/.test(p)));
});

test("rule 3: every staged id is in the checkpoint the run wrote", () => {
  const r = checkRun({ output: "CONNECTOR notion-meetings: new 2, staged 2", name: "notion-meetings", staged: [spec("a"), spec("b")], checkpoint: cp(["a"]) });
  assert.equal(r.conforms, false);
  assert.ok(r.problems.some((p) => /"b" was staged but is not in the checkpoint/.test(p)));
});

test("the status line's count agrees with what was staged, and BROKEN never stages", () => {
  assert.ok(checkRun({ output: "CONNECTOR notion-meetings: new 3, staged 3", staged: [spec("a")] }).problems.some((p) => /says staged 3, but 1/.test(p)));
  assert.ok(checkRun({ output: "CONNECTOR notion-meetings: BROKEN lost auth", staged: [spec("a")] }).problems.some((p) => /BROKEN, yet 1 item/.test(p)));
});

test("the specs are matched against the status line's name when no name is given", () => {
  const r = checkRun({ output: "CONNECTOR otter: new 1, staged 1", staged: [spec("a", "notion-meetings")] });
  assert.ok(r.problems.some((p) => /service "otter"/.test(p)));
});

test("nothing throws on garbage", () => {
  for (const g of [undefined, null, 42, "x", [], {}]) {
    assert.doesNotThrow(() => { validateDeclarations(g); parseStatusLine(g); checkOutput(g); validateStagedSpec(g); validateCheckpoint(g); checkRun({ output: g }); });
  }
});
