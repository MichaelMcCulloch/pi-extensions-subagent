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
 * turns that into `[]CoreInv`. SubagentViewProof additionally establishes the
 * ancestor, cancellation and presentation views, assembled by SafetyViews.
 *
 * The driver locates tlapm from `TLAPM`, then `~/.local/tlapm/bin/tlapm`,
 * then `PATH`, and its stdlib from `TLAPM_LIBRARY`, then the sibling lib
 * directory, then a small set of conventional install locations. TLAPS needs a
 * Z3 on `PATH`; tlapm 1.6.x works with Z3 4.8+.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
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
  const perModule = [];
  for (const proof of [...proofs, PROOF]) {
    const proofArgs = [...args, proof];

    process.stdout.write(`\n$ (cd spec && ${tlapm} ${proofArgs.join(" ")})\n`);
    const result = spawnSync(tlapm, proofArgs, {
      cwd: specDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PATH: `${dirname(tlapm)}${delimiter}${process.env.PATH ?? ""}` },
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(output);
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
      continue;
    }
    const proved = output.match(/All (\d+) obligations proved/);
    if (!proved) {
      process.stderr.write(`\nno obligation count reported for ${proof}\n`);
      failed = true;
      continue;
    }
    perModule.push({ module: proof, obligations: Number(proved[1]) });
  }
  if (failed) process.exit(1);
  const obligations = perModule.reduce((sum, entry) => sum + entry.obligations, 0);
  writeFileSync(
    resolve(specDir, ".tlaps-obligation-count.json"),
    JSON.stringify(
      {
        obligations,
        modules: perModule.length,
        perModule: Object.fromEntries(perModule.map(({module, obligations: count}) => [module, count])),
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\ninductive proof passed: Spec => []CoreInv for all constants (${obligations} obligations in ${perModule.length} modules)\n`);
}

main();
