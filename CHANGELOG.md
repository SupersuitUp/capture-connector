# Changelog

## 0.1.0 (2026-10-14)

First release. The capture-connector contract, extracted from Freedom's
`freedom-capture-connectors.mjs`, where it lived only as prose in the skeleton a new connector
starts from.

- `validateDeclarations`: the `capture.connectors` declaration rules (name, skill, kind defaulting
  to `meetings`, no duplicates), unchanged from Freedom.
- `formatStatus`, `formatBroken`, `parseStatusLine`, `checkOutput`: the one status line a run ends
  with, `CONNECTOR <name>: new <n>, staged <n>` or `CONNECTOR <name>: BROKEN <why>`.
- `validateStagedSpec`, `validateCheckpoint`, `checkRun`: stage never file, dedupe by recording id,
  checkpoint only after staging.
- `capture-connector` CLI: `check` (pipe a run's output in), `status`, `config`, `--json`, exit codes
  0 / 3 (honest BROKEN) / 1 / 2.
- TypeScript types in `src/index.d.ts`. Zero dependencies, Node 20 or later.
