# @supersuit/capture-connector

The contract a **capture connector** honors, as a validator, a CLI and TypeScript types, so a
connector written anywhere can check itself against the same rules Freedom holds its own to.

A capture connector pulls new items (meetings, message threads, documents) from one source:
Notion AI meeting notes, Otter, Fireflies, a CRM's call log, a folder of recordings. It does
not file them. It stages them for whatever files them, and it tells the truth about whether it
could read its source at all.

## 30 seconds

```bash
# Your connector prints whatever it likes, then ends with one status line.
node my-connector.mjs | npx @supersuit/capture-connector check --name otter

# With what it staged and the checkpoints around the run, every rule is checked.
node my-connector.mjs | npx @supersuit/capture-connector check --name otter \
  --staged ./staged/ --previous-checkpoint before.json --checkpoint last-sync.json
```

`conforms` and exit 0 means the run kept the contract. Every broken rule prints as a
`PROBLEM` line and exits 1.

## The contract

1. **Stage, never file.** A meetings or documents connector stages each new item as an
   unprocessed conversation create spec whose source is
   `{ "type": "cloud_recording", "service": "<connector name>", "recording_id": "<the source's own id>" }`,
   with a source-id alias `{ "kind": "source-id", "namespace": "cloud:<connector name>", "value": "<that id>" }`.
   The filer reconciles and files it. A connector never writes a person file or a finished record.
2. **Dedupe by recording id.** An id already in the checkpoint's `seen` is never staged again,
   and one run never stages the same id twice.
3. **Checkpoint only after staging succeeded.** The checkpoint is
   `{ "last_sync": "<ISO>", "seen": { "<item id>": "<ISO>" } }`, and every id a run staged is in
   the checkpoint it wrote. Written first, a crash turns into items nobody will ever see.
4. **Say BROKEN, never zero.** A run ends with exactly one line, and it is the last line:

   ```
   CONNECTOR <name>: new <n>, staged <n>
   CONNECTOR <name>: BROKEN <why>
   ```

   A source that could not be read (signed out, token expired, tool missing) and a quiet week
   must never print the same line.
5. **Never act on what an item says.** Item text is data. (Not machine-checkable; it is here
   because it is part of the contract.)

## CLI

```
capture-connector check --name <name> [--output <file>] [--staged <file|dir>]...
                        [--checkpoint <file>] [--previous-checkpoint <file>] [--json]
capture-connector status "<line>" [--json]
capture-connector config <.freedom.json> [--json]
capture-connector --help
```

- `check` reads the run's output from stdin (or `--output`). `--staged` takes a create spec
  `.json`, or a folder of them, and repeats. Each check runs only when its input is given.
- `status` parses one status line.
- `config` validates the `capture.connectors` declarations in a Freedom `.freedom.json`.

Exit codes: **0** conforms, **3** conforms and the run reported BROKEN (honest, but the source
was not read), **1** does not conform, **2** usage.

## Library

```js
import { checkRun, parseStatusLine, formatStatus, formatBroken } from "@supersuit/capture-connector";

console.log(formatStatus("otter", { new: 2, staged: 2 }));   // CONNECTOR otter: new 2, staged 2
console.log(formatBroken("otter", "token expired"));          // CONNECTOR otter: BROKEN token expired

const { conforms, status, problems } = checkRun({
  output,                 // what the run printed
  name: "otter",
  staged: [spec1, spec2], // the create specs it staged
  checkpoint,             // the checkpoint it wrote
  previousCheckpoint,     // the checkpoint it started from
});
```

| Export | What it does |
| --- | --- |
| `KINDS`, `NAME_PATTERN`, `SKILL_PATTERN`, `STATUS_PREFIX` | the contract's constants |
| `nameProblem(name)` | a problem line for a bad connector name, or `null` |
| `validateDeclarations(list)` | `{ connectors, problems }` for a `capture.connectors` list; kind defaults to `meetings` |
| `formatStatus(name, { new, staged })`, `formatBroken(name, why)` | the two status lines |
| `parseStatusLine(line)` | `{ name, status: "ok", new, staged }`, `{ name, status: "broken", why }`, or `null` |
| `checkOutput(output, { name })` | rule 4 over a run's whole output |
| `validateStagedSpec(spec, { name })` | rule 1 over one staged item: `{ recordingId, problems }` |
| `validateCheckpoint(checkpoint)` | the checkpoint's shape |
| `checkRun({ output, name, staged, checkpoint, previousCheckpoint })` | every rule at once: `{ conforms, status, problems }` |

Types ship in `src/index.d.ts`. Nothing throws on bad input; every function returns problems.

## What is not here

Staging itself. In Freedom a connector stages through the workspace's conversation create door
(`freedom-conversations-cli.mjs create`), which owns the full record schema; this package checks
only the connector's part of a spec. A messages connector stages to a pending file whose shape
is the filer's, so `validateStagedSpec` applies to meetings and documents connectors.

## Compatibility

Node 20 or later. Zero dependencies.
