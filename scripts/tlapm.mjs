#!/usr/bin/env node
/**
 * Inductive-proof driver (TLAPS / tlapm).
 *
 *   node scripts/tlapm.mjs        check spec/SubagentSystemProof.tla
 *
 * Proves `Spec => []CoreInv` for EVERY value of `Agents`, `Root`, `Names`,
 * `Worktrees`, `MaxDepth`, `MaxGen`, and `MaxSeq` -- the parameterized
 * SubagentSystem, not the TLC fixture. `spec/SubagentSystemProof.tla` establishes
 * `Init => CoreInv` and that each action preserves each CoreInv component; `PTL`
 * turns that into `[]CoreInv`. CoreInv is the machine safety core; the recursive
 * view invariants (`CancelCascade`, the presentation laws) are TLC-checked.
 *
 * The driver locates tlapm from `TLAPM`, then `~/.local/tlapm/bin/tlapm`,
 * then `PATH`, and its stdlib from `TLAPM_LIBRARY`, then the sibling lib
 * directory, then a small set of conventional install locations. TLAPS needs a
 * Z3 on `PATH`; tlapm 1.6.x works with Z3 4.8+.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const specDir = resolve(root, "spec");
const PROOF = "SubagentSystemProof.tla";

function findTlapm() {
  const candidates = [
    process.env.TLAPM,
    resolve(process.env.HOME ?? "", ".local/tlapm/bin/tlapm"),
    "/usr/local/bin/tlapm",
    "/usr/bin/tlapm",
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    if (candidate === "tlapm" || existsSync(candidate)) return candidate;
  }
  return "tlapm";
}

function findStdlib(tlapm) {
  if (process.env.TLAPM_LIBRARY) return process.env.TLAPM_LIBRARY;
  const candidates = [
    resolve(dirname(tlapm), "..", "lib/tlapm/stdlib"),
    resolve(process.env.HOME ?? "", ".local/tlapm/lib/tlapm/stdlib"),
    "/usr/local/lib/tlapm/stdlib",
    "/usr/lib/tlapm/stdlib",
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "TLAPS.tla"))) return candidate;
  }
  return undefined;
}

function main() {
  const tlapm = findTlapm();
  const stdlib = findStdlib(tlapm);
  const args = [];
  if (stdlib) args.push("-I", stdlib);
  args.push("--strict", "--debug", "oldsmt");
  const proofs = readdirSync(specDir).filter(name => /^Subagent.*Proof\.tla$/.test(name) && name !== PROOF).sort();
  let failed = false;
  for (const proof of [...proofs, PROOF]) {
    const proofArgs = [...args, proof];

    process.stdout.write(`\n$ (cd spec && ${tlapm} ${proofArgs.join(" ")})\n`);
    const result = spawnSync(tlapm, proofArgs, {
      cwd: specDir,
      stdio: "inherit",
      env: { ...process.env, PATH: `${dirname(tlapm)}${delimiter}${process.env.PATH ?? ""}` },
    });
    if (result.error) {
      process.stderr.write(
        `\nTLAPS not available (${result.error.message}).\n` +
          "Install tlapm 1.6+ (e.g. https://github.com/tlaplus/tlapm/releases) and a Z3 on PATH,\n" +
          "or set TLAPM and TLAPM_LIBRARY.\n",
      );
      process.exit(1);
    }
    if (result.status !== 0) {
      process.stderr.write(`\ninductive proof failed (tlapm exit ${result.status ?? "signal"})\n`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  process.stdout.write("inductive proof passed: Spec => []CoreInv for all constants\n");
}

main();
