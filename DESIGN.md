# Design record

The specification is the source of truth. All state transitions in production
flow through `referenceReduceSubagentState`; the store checks the full view
invariant before appending a snapshot. Commands only attach payload to model
events. There is no second lifecycle reducer in the runtime.

## Machine and view

The machine tracks lifecycle, authority, parent/depth, identity/order,
generation-fenced effects, worktree reservations, cleanliness, and crash debt.
Its 18-component `CoreInv` constrains every transition. The recursive view adds
cancellation of all descendants and total presentation. Projection sorts by
`seq` and maps the specification's row and authority tokens directly to text.

The finite fixture is deliberately large enough to contain a grandchild,
attenuation, dirty cleanup refusal, crashes between reservation and creation,
and slot reuse after clear. Production has a larger fixed agent universe and
bounds. Its string name/path universes are represented by their used subset;
adding an unused string does not change any existing record or predicate.
This embedding is an implementation convention, not a separate TLAPS theorem.

## Proof construction

Each theorem repeats anonymous assumptions on the root, natural bounds, and
sentinels. Top-level component lemmas avoid the assumption loss encountered in
nested temporal proofs. Variable ranges are proved separately. Components use
`TypeOK` and their own precondition, with small additional invariant hypotheses
where needed: tree shape for authority preservation, sequence bounds for
sequence uniqueness, terminal soundness for cancellation, and stale soundness
for reconciliation. The action theorem assembles the components; `NextCore`
includes stuttering; `SafetyCore` uses temporal induction.

The generator emits a module per action, an initialization module, and the
final assembly. A monolithic module made TLAPS retain a large accumulated
context; splitting bounds this cost. The driver checks every imported proof
module, so a green assembly cannot mask an unproved imported lemma. SMT(v2) is
the primary backend, with small Isabelle obligations where encoding needs it.
No proof is admitted with `OMITTED` or `OBVIOUS` placeholders.

`GuardReconcile` requires an idle effect. Without that requirement the stated
invariant permits a stale record with a live effect; reconciliation would
settle it without removing that effect. The guard strengthening is necessary
for inductive safety and does not change the TLC fixture's reachable count.
No other machine behavior was changed during implementation.

## Host effects and recovery

Dispatch records intent synchronously, then starts asynchronous setup. The
extension creates the worktree before `AddWorktree`, creates/binds a child
session, and admits it before prompting. The SDK is resolved relative to the
running host when possible, falling back to the installed package. The parent
model object and thinking level are passed explicitly. Resource loading keeps
ambient extensions enabled and adds this entry point for recursion.

A process-global, symbol-keyed registry survives repeated extension module
loads. It maps the child session ID to authority and the shared root store and
parent-tree slot before binding extensions. The child's factory removes the
tool when spawn is absent. Its own runtime dispatches using that slot as `d`,
so the same model guards enforce transitive attenuation.

Session completion and cancellation abort the child, emit its shutdown event
so grandchildren shut down, and dispose it before settling the record. Callbacks
check the captured generation. Setup failure cannot call `Fail` before there
is a live effect, so it uses `Cancel` and retains the failure report. Wait is
an explicit promise join; aborting that join does not cancel the child.

Persistence is owned by the root store. Branch switching captures the target
snapshot and detaches old persistence before shutting down old children; old
shutdown events cannot overwrite the new branch. Recovery uses `PiCrash` and
then deepest-first `Reconcile`. No restored effect is treated as still alive.

Git commands use argument arrays. Existing worktrees are verified before reuse.
Cleanup rejects symlinks, requires a path inside the designated root, checks
cleanliness including untracked files, and never forces removal or deletes a
branch. An external filesystem race can still make Git refuse the operation;
the model records removal only after Git succeeds. Allocation, Git commits,
SDK streams, and result delivery are trusted environment effects, outside the
parameterized state-machine proof.

## Validation boundary

TLC checks safety and fairness-based liveness only for the finite fixture.
TLAPS proves safety for arbitrary constants satisfying the assumptions; it
does not prove recursive presentation, liveness, or the TypeScript compiler.
The exhaustive mirror count and invariant checks detect drift; production
store traces independently replay named TLA guards and exact successors.
Runtime tests fake SDK sessions, while Git tests use actual temporary repos.
A live-provider smoke test remains a deployment check, not part of `verify`.
