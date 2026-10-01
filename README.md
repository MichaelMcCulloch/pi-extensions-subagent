# pi-subagent-lifecycle

A pi extension for named, in-process subagents. Dispatch returns immediately;
results arrive as `subagent/result` messages that wake the dispatcher. Children
use the dispatcher's model and load ambient extensions, including this one.
Spawning authority is explicitly attenuated down the dispatch tree.

The lifecycle comes first: `spec/SubagentSystem.tla` owns the machine,
`src/formal/model.ts` transcribes it, and the production store calls that
reference reducer directly. Payload never appears in a guard. The widget and
tool share a pure projection of the resulting state.

## Use

```sh
npx --yes pnpm@10 install
pi --extension ./src/index.ts
npx --yes pnpm@10 run verify
```

Examples of tool arguments:

```json
{"action":"dispatch","name":"review","task":"Review the parser changes"}
{"action":"dispatch","name":"implement","task":"Implement the parser fix","worktree":true}
{"action":"dispatch","name":"coordinator","task":"Divide the investigation","spawn":true,"grant":true}
{"action":"list"}
{"action":"wait","name":"review"}
{"action":"cancel","name":"implement"}
{"action":"cleanup","name":"implement","clear":true}
```

The one tool is `subagent`. `dispatch` requires `name` and `task` (or `brief`).
`status` optionally accepts a name and includes its saved result. `wait` blocks
until that child finishes; interrupting the wait leaves the child running.
`cancel` stops a child and shuts down its descendants. `cleanup` removes a
settled, clean worktree; `clear: true` also forgets the record. The separate
`clear` action forgets a settled record only when its worktree and child records
are already gone. Ancestors can inspect and clean up settled descendants by name;
clear descendants before their parent. `wait` and `cancel` target direct children
(cancellation cascades through their sessions). Refusals throw stable
`subagent-*` errors.

The widget sits above the editor; `/subagent` opens the tree inspector. Rows
are ordered by ascending dispatch sequence, indented by depth, and use the
model's `RowToken`:

| Token | Glyph | Meaning |
|---|---|---|
| queued | ○ | Dispatch recorded; setup pending |
| running | ● | Current child session admitted |
| completed | ✓ | Child finished |
| failed | ! | Admitted child failed |
| cancelled | × | Cancelled, or setup failed before admission |
| lost | ? | Restored record had no surviving session |

## Authority

Roots have `{spawn:true, grant:true}`. Children default to neither capability.
A dispatcher needs `spawn` to dispatch. Granting either bit requires its own
`grant`; a child with `grant` must also have `spawn`. A child with spawn alone
can dispatch children that have neither capability.

Authority travels out-of-band, keyed by the SDK session ID before extensions
bind. Children share the root's modeled tree and durable store, so a recursive
dispatch checks the real parent record. Without spawn authority, `subagent` is
excluded from the child's allowlist and deactivated during `session_start`.
This is a capability of this extension, not an OS sandbox: ordinary shell and
file tools remain governed by the host's policies.

## Worktrees

`worktree: true` asks the extension to run `git worktree add -b` and use that
directory as the child's cwd. Paths live under `<repo>/.worktrees/subagents/`;
branches are `dsh/subagent/<generation>/<sanitized-name>`, where generation
contains the dispatcher session ID and dispatch sequence. Existing allocations
are checked and reused without resetting their branches or deleting files.

Allocation only: there is no automatic merge. Cleanup probes Git, requires a
settled child and a clean directory (including untracked files), and removes
without `--force`. Committed work stays on the retained branch. Paths outside
the root and symlink paths are refused. Ignore `.worktrees/` in the host repo.

## Verification

TLC 1.8.0 checks the complete fixture: **1,913,513 generated states, 360,964
distinct states, depth 17**, with core safety, recursive view invariants, and
liveness passing. The fixture has three agent slots including the root, two
names, two worktrees, depth two, two generations, and three dispatch sequence
numbers. The exhaustive TypeScript test reaches the same 360,964 states and
checks every core/view invariant in every state. Equal counts are a drift
check, not a proof that two arbitrary transition systems are equivalent.

TLAPS proves parameterized inductive safety, `Spec => []CoreInv`, under explicit
constant assumptions: **1,511 obligations proved**, recorded per module in
`spec/.tlaps-obligation-count.json`. Generated per-action proof
modules are checked individually before the temporal assembly. Recursive views and liveness are
TLC checks, not TLAPS claims. Regenerate all proofs with:

```sh
node scripts/gen-proof.mjs spec/SubagentSystemProof.tla
node scripts/tlapm.mjs
```

Trace validation drives the production store through **256 traces covering all
13 actions**, then TLC replays their guards, transitions, and complete abstract
states: **10,496 distinct trace states** (the count includes the trace index;
the emitted data contains **3,053 distinct abstract states**). Both numbers are
recorded in `spec/.trace-state-count.json`. Tests also exercise persistence,
authority binding, asynchronous dispatch, shutdown, tool refusals, projection,
and real Git worktrees. SDK lifecycle tests use a fake session; verification
does not call a paid model or prove SDK, Git, filesystem, or model behavior.

```sh
npx --yes pnpm@10 run typecheck
npx --yes pnpm@10 run test
node scripts/tla.mjs all
node scripts/tlapm.mjs
```

Java 11+, TLAPS, and its prover backends are required. TLC's pinned jar is
cached in `spec/vendor`; the driver downloads it if absent. `TLAPM`,
`TLAPM_LIBRARY`, `TLA2TOOLS_JAR`, `JAVA`, and `TLA_JVM_MEMORY` override discovery.
The TLAPS driver uses SMT(v2), selected with `--debug oldsmt`, plus narrowly
scoped Isabelle lemmas. `.tlc-state-count.json`, `.trace-state-count.json`, and
`.tlaps-obligation-count.json` are tracked and refreshed by their drivers.

## Scope and layout

Production uses 128 child slots, maximum depth 16, and safe-integer generation
and sequence bounds. Names and worktree paths are arbitrary strings; the finite
used subset is materialized for reference-reducer checks. Task briefs, reports,
paths/branches/heads, timestamps, and snapshot revision are payload.

Snapshots are `subagent/state` entries on the root session branch. Loading a
branch invalidates restored live effects through `PiCrash`, then reconciles
children before parents to `lost`. Sessions are never silently restarted.
Worktree declarations are reconciled from disk during cleanup. A created
worktree deleted externally requires manual repair; the current machine only
models discovery of declared reservations.

Notifications follow durable settlement, but delivery is not transactional with
session persistence: a process crash in that gap can leave a saved report
without a notification. Read it with `status`. Failures before admission settle
as `cancelled`, with the error saved as the report, because the specification's
`Fail` action requires a live effect.

| Path | Responsibility |
|---|---|
| `spec/` | Machine, recursive view, TLC fixtures, generated safety proofs, trace replay |
| `src/formal/` | Executable machine, guards, invariants |
| `src/engine/` | Durable payload, commands, projection, diagnostics, Git |
| `src/extension/` | Store, SDK runtime, tool, widget |
| `src/index.ts` | Host lifecycle wiring |
| `scripts/` | Proof generation, TLC/TLAPS drivers, store traces |
| `test/` | Exhaustive mirror and integration tests |

There is no dependency on the board, DAG, monitor, or todo extension. They are
available to children through ambient extension discovery.
