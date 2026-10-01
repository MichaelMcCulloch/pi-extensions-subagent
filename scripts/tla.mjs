#!/usr/bin/env node
/**
 * Formal verification driver.
 *
 *   node scripts/tla.mjs model    exhaustive TLC check of the state machine
 *   node scripts/tla.mjs traces   regenerate implementation traces and validate
 *   node scripts/tla.mjs all      both
 *
 * TLC ships as a JVM jar. The driver finds a jar from `TLA2TOOLS_JAR`, then
 * `spec/vendor/tla2tools.jar`, and otherwise downloads the pinned release.
 * Override the JVM with `JAVA`.
 *
 * Memory is bounded deliberately: TLC runs with `TLA_JVM_MEMORY` (default 4g)
 * and the Node side of trace generation uses the default heap. The whole
 * verification pipeline stays far inside a 12 GiB budget.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const specDir = resolve(root, "spec");
const generatedDir = resolve(specDir, "generated");
const vendorJar = resolve(specDir, "vendor/tla2tools.jar");
const TLA_VERSION = "v1.8.0";
const TLA_URL = `https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar`;
const MEMORY = process.env.TLA_JVM_MEMORY ?? "4g";

const command = process.argv[2] ?? "all";

function javaMajor(candidate) {
  const probe = spawnSync(candidate, ["-version"], { encoding: "utf8" });
  if (probe.status !== 0) return -1;
  const text = `${probe.stderr ?? ""}${probe.stdout ?? ""}`;
  const match = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return -1;
  const major = Number(match[1]);
  return major === 1 ? Number(match[2] ?? "0") : major;
}

function findJava() {
  const candidates = [
    process.env.JAVA,
    "java-11",
    "/usr/lib/jvm/java-11-openjdk/bin/java",
    "/usr/lib/jvm/java-17-openjdk/bin/java",
    "/usr/lib/jvm/java-21-openjdk/bin/java",
    "/usr/lib/jvm/default/bin/java",
    "java",
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    if (javaMajor(candidate) >= 11) return candidate;
  }
  throw new Error("no Java 11+ runtime found; set JAVA to a Java 11+ executable");
}

async function ensureJar() {
  if (process.env.TLA2TOOLS_JAR) return process.env.TLA2TOOLS_JAR;
  if (existsSync(vendorJar) && statSync(vendorJar).size > 1_000_000) return vendorJar;
  process.stdout.write(`downloading TLA+ tools ${TLA_VERSION} -> ${vendorJar}\n`);
  const response = await fetch(TLA_URL);
  if (!response.ok) throw new Error(`failed to download ${TLA_URL}: ${response.status}`);
  mkdirSync(dirname(vendorJar), { recursive: true });
  writeFileSync(vendorJar, Buffer.from(await response.arrayBuffer()));
  return vendorJar;
}

function tlcArgs(jar, module, config) {
  return [
    `-Xmx${MEMORY}`,
    "-XX:+UseParallelGC",
    "-cp",
    `${jar}${delimiter}${generatedDir}`,
    "tlc2.TLC",
    "-cleanup",
    "-config",
    config,
    module,
  ];
}

function checkModel(java, jar) {
  const logPath = resolve(specDir, "tlc-model.log");
  const args = tlcArgs(jar, "SubagentView.tla", "SubagentSystemFixture.cfg");
  process.stdout.write(`\n$ (cd spec && ${java} ${args.join(" ")})\n`);
  const result = spawnSync(java, args, { cwd: specDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  writeFileSync(logPath, output, "utf8");
  if (result.status !== 0) throw new Error(`TLC failed for the model (exit ${result.status})`);

  const distinct = output.match(/([\d,]+)\s+states generated,\s*([\d,]+)\s+distinct states found/);
  if (!distinct) throw new Error("TLC did not report a distinct-state count");
  const count = Number(distinct[2].replaceAll(",", ""));
  writeFileSync(
    resolve(specDir, ".tlc-state-count.json"),
    JSON.stringify({ distinctStates: count, version: TLA_VERSION }, null, 2),
  );
  process.stdout.write(`\nmodel checked: ${count} distinct reachable states (JVM cap ${MEMORY})\n`);
  return count;
}

/** Run a command, echo its combined output, and return it. */
function runCommandCaptured(commandName, args) {
  const result = spawnSync(commandName, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.status !== 0) throw new Error(`${commandName} ${args.join(" ")} failed`);
  return output;
}

/** Regenerate the production traces, replay them in TLC, and record the counts. */
function checkTraces(java, jar) {
  const emitted = runCommandCaptured(resolve(root, "node_modules/.bin/tsx"), ["scripts/emit-traces.ts"]);
  const summary = emitted.match(/trace-summary: traces=(\d+) actions=(\d+) abstractStates=(\d+)/);
  if (!summary) throw new Error("trace emitter did not report a trace-summary line");

  const args = tlcArgs(jar, "TraceValidation.tla", "TraceValidation.cfg");
  process.stdout.write(`\n$ (cd spec && ${java} ${args.join(" ")})\n`);
  const result = spawnSync(java, args, { cwd: specDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.status !== 0) throw new Error(`TLC failed for trace validation (exit ${result.status ?? "signal"})`);
  const replay = output.match(/([\d,]+)\s+states generated,\s*([\d,]+)\s+distinct states found/);
  if (!replay) throw new Error("trace validation did not report a distinct-state count");

  writeFileSync(
    resolve(specDir, ".trace-state-count.json"),
    JSON.stringify(
      {
        traces: Number(summary[1]),
        actions: Number(summary[2]),
        abstractStates: Number(summary[3]),
        replayStates: Number(replay[2].replaceAll(",", "")),
        version: TLA_VERSION,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `\ntrace validation passed: ${summary[1]} traces, ${summary[2]} actions, ${summary[3]} abstract states, ${replay[2]} distinct replay states\n`,
  );
}

async function main() {
  const java = findJava();
  const jar = await ensureJar();

  if (command === "model" || command === "all") {
    checkModel(java, jar);
  }
  if (command === "traces" || command === "all") {
    checkTraces(java, jar);
  }
  if (!["model", "traces", "all"].includes(command)) {
    throw new Error(`unknown command ${command}; expected model, traces, or all`);
  }
}

main().catch((error) => {
  process.stderr.write(`\nformal verification failed: ${error.message}\n`);
  process.exit(1);
});
