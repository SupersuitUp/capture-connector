// Types for @supersuit/capture-connector. The runtime is src/index.mjs.

export type ConnectorKind = "meetings" | "messages" | "documents";

export declare const KINDS: readonly ConnectorKind[];
export declare const NAME_PATTERN: RegExp;
export declare const SKILL_PATTERN: RegExp;
export declare const STATUS_PREFIX: "CONNECTOR";

/** One declared connector, as Freedom's `.freedom.json` holds it under `capture.connectors`. */
export interface ConnectorDeclaration {
  name: string;
  skill: string;
  kind: ConnectorKind;
  description: string;
}

/** A connector's checkpoint: `$FREEDOM_STATE/<name>/last-sync.json` in Freedom. */
export interface Checkpoint {
  last_sync: string;
  seen: Record<string, string>;
}

/** The connector's part of a staged conversation create spec. The rest is the filer's. */
export interface CloudRecordingSource {
  type: "cloud_recording";
  service: string;
  recording_id: string;
  vendor_id?: null;
  [field: string]: unknown;
}
export interface SourceIdAlias {
  kind: "source-id";
  namespace: string;
  value: string;
}
export interface StagedSpec {
  header: {
    sources: Array<CloudRecordingSource | Record<string, unknown>>;
    aliases: Array<SourceIdAlias | Record<string, unknown>>;
    [field: string]: unknown;
  };
  [field: string]: unknown;
}

export type StatusLine =
  | { name: string; status: "ok"; new: number; staged: number }
  | { name: string; status: "broken"; why: string };

export interface OutputCheck {
  name?: string;
  status: "ok" | "broken" | null;
  new?: number;
  staged?: number;
  why?: string;
  line: string | null;
  problems: string[];
}

export interface RunCheck {
  conforms: boolean;
  status: "ok" | "broken" | null;
  problems: string[];
}

export declare function nameProblem(name: unknown): string | null;
export declare function validateDeclarations(raw: unknown, options?: { where?: string }): { connectors: ConnectorDeclaration[]; problems: string[] };
export declare function formatStatus(name: string, counts: { new: number | string; staged: number | string }): string;
export declare function formatBroken(name: string, why: string): string;
export declare function parseStatusLine(line: string): StatusLine | null;
export declare function checkOutput(output: string, options?: { name?: string }): OutputCheck;
export declare function validateStagedSpec(spec: unknown, options?: { name?: string }): { recordingId: string | null; problems: string[] };
export declare function validateCheckpoint(checkpoint: unknown): { problems: string[] };
export declare function checkRun(run: {
  output: string;
  name?: string;
  staged?: unknown[];
  checkpoint?: unknown;
  previousCheckpoint?: unknown;
}): RunCheck;
