#!/usr/bin/env node
// capture-connector: check a capture connector's run against the contract.
//
//   <your connector> | capture-connector check --name <name> [--staged <file|dir>]... \
//       [--checkpoint <file>] [--previous-checkpoint <file>] [--json]
//   capture-connector check --output <file> ...       the run's output from a file instead of stdin
//   capture-connector status "<line>" [--json]        parse one status line
//   capture-connector config <.freedom.json> [--json] validate capture.connectors declarations
//
// Exit codes: 0 conforms, 3 conforms and reported BROKEN, 1 does not conform, 2 usage.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkRun, parseStatusLine, validateDeclarations } from "../src/index.mjs";

const HELP = `capture-connector: check a capture connector against the contract

  <connector run> | capture-connector check --name <name> [options]
      --output <file>               read the run's output from a file instead of stdin
      --staged <file|dir>           a staged create spec (.json), or a folder of them; repeatable
      --checkpoint <file>           the checkpoint the run wrote
      --previous-checkpoint <file>  the checkpoint the run started from
  capture-connector status "<line>"          parse one status line
  capture-connector config <.freedom.json>   validate capture.connectors declarations
  --json   machine-readable output

The contract: stage, never file; dedupe by recording id; checkpoint only after staging;
end with exactly one line, "CONNECTOR <name>: new <n>, staged <n>" or "CONNECTOR <name>: BROKEN <why>".

Exit codes: 0 conforms, 3 conforms and reported BROKEN, 1 does not conform, 2 usage.`;

function parse(argv) {
  const opts = { staged: [], positionals: [] };
  const valued = new Set(["--name", "--output", "--staged", "--checkpoint", "--previous-checkpoint"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (valued.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      if (a === "--staged") opts.staged.push(v); else opts[a.slice(2)] = v;
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.positionals.push(a);
  }
  return opts;
}

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Error(`${file}: ${e.code === "ENOENT" ? "not found" : "not valid JSON"}`); }
};

function stagedSpecs(paths) {
  const specs = [];
  for (const p of paths) {
    let isDir;
    try { isDir = statSync(p).isDirectory(); } catch { throw new Error(`${p}: not found`); }
    if (isDir) for (const f of readdirSync(p).filter((n) => n.endsWith(".json")).sort()) specs.push(readJson(join(p, f)));
    else specs.push(readJson(p));
  }
  return specs;
}

function report(result, json, okLine) {
  if (json) console.log(JSON.stringify(result, null, 1));
  else {
    for (const p of result.problems ?? []) console.log(`PROBLEM ${p}`);
    if (!(result.problems ?? []).length) console.log(okLine);
  }
}

function main(argv) {
  let o;
  try { o = parse(argv); } catch (e) { console.error(e.message); return 2; }
  const [command, arg] = o.positionals;
  if (o.help || !command) { console.log(HELP); return o.help ? 0 : 2; }
  try {
    if (command === "check") {
      if (o.positionals.length > 1) throw new Error("check takes no positional arguments; pipe the run's output in, or pass --output");
      if (!o.output && process.stdin.isTTY) throw new Error("check reads the run's output from stdin; pipe it in, or pass --output <file>");
      const output = readFileSync(o.output ?? 0, "utf8");
      const run = { output, name: o.name };
      if (o.staged.length) run.staged = stagedSpecs(o.staged);
      if (o.checkpoint) run.checkpoint = readJson(o.checkpoint);
      if (o["previous-checkpoint"]) run.previousCheckpoint = readJson(o["previous-checkpoint"]);
      const r = checkRun(run);
      report(r, o.json, r.status === "broken" ? "conforms (the run reported BROKEN)" : "conforms");
      return r.conforms ? (r.status === "broken" ? 3 : 0) : 1;
    }
    if (command === "status") {
      if (arg === undefined) throw new Error('status needs a line: capture-connector status "CONNECTOR <name>: new 1, staged 1"');
      const parsed = parseStatusLine(arg);
      const r = parsed ?? { problems: [`not a status line: "${arg}"`] };
      if (o.json) console.log(JSON.stringify(r, null, 1));
      else if (!parsed) console.log(`PROBLEM ${r.problems[0]}`);
      else console.log(parsed.status === "ok" ? `${parsed.name}: ok, new ${parsed.new}, staged ${parsed.staged}` : `${parsed.name}: BROKEN ${parsed.why}`);
      return !parsed ? 1 : parsed.status === "broken" ? 3 : 0;
    }
    if (command === "config") {
      if (arg === undefined) throw new Error("config needs a path to a .freedom.json");
      const r = validateDeclarations(readJson(arg)?.capture?.connectors);
      if (o.json) console.log(JSON.stringify(r, null, 1));
      else {
        if (!r.connectors.length && !r.problems.length) console.log("no connectors declared");
        for (const c of r.connectors) console.log(`${c.name}  (${c.kind})  skill: ${c.skill}`);
        for (const p of r.problems) console.log(`PROBLEM ${p}`);
      }
      return r.problems.length ? 1 : 0;
    }
    throw new Error(`unknown command "${command}"\n\n${HELP}`);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
