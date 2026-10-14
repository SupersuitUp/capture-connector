// @supersuit/capture-connector: the contract a capture connector honors, as code.
//
// A capture connector pulls new items (meetings, message threads, documents) from one source
// and hands them to whatever files them. Freedom's catch-up-freeda dispatches connectors an
// operator declares in `.freedom.json`, and the contract they honor used to live only as prose
// in the skeleton Freedom writes. This package is that contract, checkable by anyone:
//
//   1. Stage, never file. A meetings or documents connector stages each item as an unprocessed
//      conversation whose source is { type: "cloud_recording", service: <connector name>,
//      recording_id: <the source's own id> }, with a `cloud:<connector name>` source-id alias.
//   2. Dedupe by recording id. An id already in the checkpoint's `seen` is never staged again,
//      and one run never stages the same id twice.
//   3. Checkpoint only after staging succeeded. Every id a run staged is in the checkpoint it
//      wrote, so a crash between the two can only cause a re-stage, never a lost item.
//   4. Say BROKEN, never zero. A run ends with exactly one status line:
//        CONNECTOR <name>: new <n>, staged <n>
//        CONNECTOR <name>: BROKEN <why>
//      A source that could not be read and a quiet week never print the same line.
//
// Zero dependencies. Every function is pure and never throws on bad input: it returns problems.

export const KINDS = Object.freeze(["meetings", "messages", "documents"]);
/** A connector name: lowercase letters, digits and dashes, 2 to 41 characters. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** A skill name is a folder name, never a path. */
export const SKILL_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;
export const STATUS_PREFIX = "CONNECTOR";

const STATUS = /^CONNECTOR ([a-z0-9][a-z0-9-]{1,40}): (?:new (\d+), staged (\d+)|BROKEN(?: (.*))?)$/;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim() !== "";
const isoInstant = (v) => text(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));

/** A problem line for a name that breaks the contract, or null. */
export function nameProblem(name) {
  return NAME_PATTERN.test(String(name ?? "")) ? null : "name must be lowercase letters, digits and dashes, 2 to 41 characters";
}

/**
 * Validate a list of connector declarations (Freedom's `capture.connectors`). Returns the
 * entries that can be dispatched, normalized, and a named problem for every one that cannot.
 * A bad entry is never silently dropped. `undefined` is the normal "none declared" case.
 */
export function validateDeclarations(raw, { where = "capture.connectors" } = {}) {
  if (raw === undefined) return { connectors: [], problems: [] };
  if (!Array.isArray(raw)) return { connectors: [], problems: [`${where} is not a list`] };
  const connectors = [], problems = [], seen = new Set();
  for (const [i, c] of raw.entries()) {
    const at = `${where}[${i}]`;
    if (!object(c)) { problems.push(`${at} is not an object`); continue; }
    if (!NAME_PATTERN.test(String(c.name ?? ""))) { problems.push(`${at}: name must be lowercase letters, digits and dashes`); continue; }
    if (seen.has(c.name)) { problems.push(`${at}: "${c.name}" is declared twice`); continue; }
    if (!String(c.skill ?? "").trim()) { problems.push(`${at} ("${c.name}"): no skill named`); continue; }
    const kind = c.kind ?? "meetings";
    if (!KINDS.includes(kind)) { problems.push(`${at} ("${c.name}"): kind must be one of ${KINDS.join(", ")}`); continue; }
    seen.add(c.name);
    connectors.push({ name: c.name, skill: String(c.skill).trim(), kind, description: String(c.description ?? "") });
  }
  return { connectors, problems };
}

/** The success line a run ends with. Placeholders (strings) are allowed for documentation. */
export function formatStatus(name, { new: found, staged }) {
  return `${STATUS_PREFIX} ${name}: new ${found}, staged ${staged}`;
}

/** The line a run ends with when its source could not be read. */
export function formatBroken(name, why) {
  return `${STATUS_PREFIX} ${name}: BROKEN ${String(why).replace(/\s+/g, " ").trim()}`;
}

/**
 * Parse one status line. Returns null when the line is not a well-formed status line, else
 * { name, status: "ok", new, staged } or { name, status: "broken", why }.
 */
export function parseStatusLine(line) {
  const m = STATUS.exec(String(line ?? "").trim());
  if (!m) return null;
  if (m[2] !== undefined) return { name: m[1], status: "ok", new: Number(m[2]), staged: Number(m[3]) };
  return { name: m[1], status: "broken", why: (m[4] ?? "").trim() };
}

/**
 * Check a run's output against rule 4: exactly one status line, the last line printed, naming
 * this connector, a BROKEN line that says why, and never more staged than new.
 */
export function checkOutput(output, { name } = {}) {
  const problems = [];
  const lines = String(output ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const claimed = lines.map((l, i) => [l, i]).filter(([l]) => l.startsWith(`${STATUS_PREFIX} `));
  if (!claimed.length) {
    problems.push(`no ${STATUS_PREFIX} line: a run that ends without one cannot be told apart from a broken source`);
    return { status: null, line: null, problems };
  }
  if (claimed.length > 1) problems.push(`${claimed.length} ${STATUS_PREFIX} lines: a run ends with exactly one`);
  const [line, index] = claimed[claimed.length - 1];
  if (index !== lines.length - 1) problems.push(`the ${STATUS_PREFIX} line is not the last line printed`);
  const parsed = parseStatusLine(line);
  if (!parsed) {
    problems.push(`malformed status line: "${line}" (expected "${STATUS_PREFIX} <name>: new <n>, staged <n>" or "${STATUS_PREFIX} <name>: BROKEN <why>")`);
    return { status: null, line, problems };
  }
  if (name !== undefined && parsed.name !== name) problems.push(`the status line names "${parsed.name}", not "${name}"`);
  if (parsed.status === "broken" && !parsed.why) problems.push("BROKEN with no reason: say why the source could not be read");
  if (parsed.status === "ok" && parsed.staged > parsed.new) problems.push(`staged ${parsed.staged} is more than new ${parsed.new}`);
  return { ...parsed, line, problems };
}

/**
 * Check one staged item against rule 1, for a meetings or documents connector: the conversation
 * create spec carries a cloud_recording source for this connector with the source's own id, and
 * the matching `cloud:<name>` source-id alias. Only the connector's part of the spec is checked;
 * the rest of the record is the filing system's to validate.
 */
export function validateStagedSpec(spec, { name } = {}) {
  const problems = [];
  const header = spec?.header;
  if (!object(header)) return { recordingId: null, problems: ["no header: a staged item is a conversation create spec with a header"] };
  const sources = Array.isArray(header.sources) ? header.sources : [];
  const cloud = sources.filter((s) => object(s) && s.type === "cloud_recording" && (name === undefined || s.service === name));
  if (!cloud.length) {
    problems.push(`no source with type "cloud_recording"${name === undefined ? "" : ` and service "${name}"`}`);
    return { recordingId: null, problems };
  }
  if (cloud.length > 1) problems.push(`${cloud.length} cloud_recording sources for one connector: one item is one recording`);
  const source = cloud[0];
  const service = source.service;
  if (!text(service)) problems.push("the cloud_recording source has no service");
  const recordingId = text(source.recording_id) ? source.recording_id : null;
  if (!recordingId) problems.push("the cloud_recording source has no recording_id: the source's own id is what dedupes a re-run");
  if (source.vendor_id !== undefined && source.vendor_id !== null) problems.push("a cloud_recording source carries recording_id, never vendor_id");
  const aliases = Array.isArray(header.aliases) ? header.aliases : [];
  if (recordingId && text(service) && !aliases.some((a) => object(a) && a.kind === "source-id" && a.namespace === `cloud:${service}` && a.value === recordingId)) {
    problems.push(`no source-id alias { namespace: "cloud:${service}", value: "${recordingId}" }: without it a re-run cannot recognize the item`);
  }
  return { recordingId, problems };
}

/** Check a checkpoint's shape: { last_sync: "<ISO>", seen: { "<item id>": "<ISO>" } }. */
export function validateCheckpoint(checkpoint) {
  const problems = [];
  if (!object(checkpoint)) return { problems: ["the checkpoint is not an object"] };
  if (!isoInstant(checkpoint.last_sync)) problems.push("last_sync is not an ISO timestamp");
  if (!object(checkpoint.seen)) problems.push("seen is not an object of item id to ISO timestamp");
  else for (const [id, at] of Object.entries(checkpoint.seen)) if (!isoInstant(at)) problems.push(`seen["${id}"] is not an ISO timestamp`);
  return { problems };
}

/**
 * Check one whole run against the contract. Every input but `output` is optional, and a check
 * runs only when its inputs are given:
 *   output              what the run printed (rule 4)
 *   name                the connector's name, matched against the status line and the specs
 *   staged              the create specs the run staged (rules 1 and 2)
 *   checkpoint          the checkpoint the run wrote (rule 3)
 *   previousCheckpoint  the checkpoint the run started from (rule 2)
 * Returns { conforms, status, problems }: `status` is "ok", "broken" or null, and a run that
 * honestly reported BROKEN conforms.
 */
export function checkRun({ output, name, staged, checkpoint, previousCheckpoint } = {}) {
  const problems = [];
  const out = checkOutput(output, { name });
  problems.push(...out.problems);
  const ids = [];
  if (staged !== undefined) {
    for (const [i, spec] of staged.entries()) {
      const r = validateStagedSpec(spec, { name: name ?? out.name });
      problems.push(...r.problems.map((p) => `staged[${i}]: ${p}`));
      if (r.recordingId) ids.push(r.recordingId);
    }
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    for (const id of dupes) problems.push(`recording "${id}" was staged twice in one run`);
    if (out.status === "ok" && out.staged !== staged.length) problems.push(`the status line says staged ${out.staged}, but ${staged.length} staged item(s) were given`);
    if (out.status === "broken" && staged.length) problems.push(`BROKEN, yet ${staged.length} item(s) were staged: a run that staged items read its source`);
  }
  if (previousCheckpoint !== undefined) {
    const prev = validateCheckpoint(previousCheckpoint);
    problems.push(...prev.problems.map((p) => `previous checkpoint: ${p}`));
    const seen = object(previousCheckpoint?.seen) ? previousCheckpoint.seen : {};
    for (const id of ids) if (Object.hasOwn(seen, id)) problems.push(`recording "${id}" was already in the previous checkpoint's seen, and was staged again`);
  }
  if (checkpoint !== undefined) {
    const cur = validateCheckpoint(checkpoint);
    problems.push(...cur.problems.map((p) => `checkpoint: ${p}`));
    const seen = object(checkpoint?.seen) ? checkpoint.seen : {};
    for (const id of ids) if (!Object.hasOwn(seen, id)) problems.push(`recording "${id}" was staged but is not in the checkpoint's seen`);
  }
  return { conforms: problems.length === 0, status: out.status ?? null, problems };
}
