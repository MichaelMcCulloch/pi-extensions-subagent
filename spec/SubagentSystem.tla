------------------------ MODULE SubagentSystem ---------------------------
\* The subagent lifecycle as a single verified machine.
\*
\* A dispatcher session owns a set of named subagent slots. `Dispatch` records
\* the intent and the *attenuated* authority of the child; the extension (never
\* the agent) allocates the worktree (`AddWorktree`); `Admit` starts the
\* in-process child session; the child settles through `Complete`, `Fail`, or
\* `Cancel`. A process death invalidates every live effect (`PiCrash`), and the
\* only way back is `Reconcile` -- a lost child is never silently re-admitted.
\*
\* The machine owns everything that is not the visual representation:
\*
\*   status / terminal / stale      the lifecycle
\*   effect / effectGen / gen       the session effect and its generation fence
\*   parent / depth                 the dispatch tree
\*   authority                      the spawn/grant capability attenuation
\*   name / seq                     identity and presentation order
\*   worktree / wtState / clean     the allocate-only worktree lifecycle
\*
\* The worktree is *allocated only*: the extension runs `git worktree add` and
\* drops the child into the path; integration and merge stay the DAG's job.
\* Removal is guarded by `clean` (an environment probe), so uncommitted work is
\* never deleted by the machine.
\*
\* The tool surface follows authority exactly: an agent without `spawn`
\* authority has no `subagent` tool (`HasTool` in `SubagentView.tla`, checked by
\* TLC; the runtime deactivates it before prompting). An agent may only hand a child
\* authority it itself holds (`AuthorityAttenuation`), so authority can never
\* escalate along the tree -- the TLAPS theorem below covers arbitrary Agents.
\*
\* Actions:
\*
\*   Dispatch(d,c,n,w,a)   record a child and its attenuated authority
\*   AddWorktree(c)        the extension ran `git worktree add` in the worktree
\*   Admit(c)              start the child session effect
\*   Complete(c)           the child finished
\*   Fail(c)               the child failed (session or worktree error)
\*   Cancel(c)             the dispatcher stopped the child (no live child)
\*   ProbeWorktree(c)      the environment reports whether the worktree is clean
\*   RemoveWorktree(c)     drop a clean worktree of a settled child
\*   WorktreeFound(c)      recovery discovered a declared worktree on disk
\*   WorktreeLost(c)       recovery found no directory for a declared worktree
\*   PiCrash               every live effect is lost at once (env)
\*   Reconcile(c)          a restored live child had no session
\*   Clear(c)              forget a settled, quiescent child record
\*
\* The executable mirror is `src/formal/model.ts`; `test/model.spec.ts` asserts
\* the reachable-set size equals the number TLC reports, and
\* `spec/TraceValidation.tla` replays real store traces.
\* -------------------------------------------------------------------------

EXTENDS Naturals, TLC

CONSTANTS Agents, Root, Names, Worktrees, MaxDepth, MaxGen, MaxSeq,
          NoAgent, NoName, NoWorktree

Statuses      == {"absent", "dispatched", "running", "settled"}
Terminals     == {"none", "completed", "failed", "cancelled", "lost"}
Effects       == {"idle", "live"}
WorktreeStates == {"none", "declared", "created", "removed"}
Authorities   == [spawn: BOOLEAN, grant: BOOLEAN]

VARIABLES
    status, authority, parent, depth, name, seq, gen,
    worktree, wtState, clean, effect, effectGen, terminal, stale,
    nextSeq

vars == << status, authority, parent, depth, name, seq, gen,
           worktree, wtState, clean, effect, effectGen, terminal, stale,
           nextSeq >>

\* ---------------------------------------------------------------------------
\* Initial state
\* ---------------------------------------------------------------------------

RootAuthority == [spawn |-> TRUE, grant |-> TRUE]
NoAuthority   == [spawn |-> FALSE, grant |-> FALSE]

ChildOf(a) == a # Root

Init ==
    /\ status     = [a \in Agents |-> IF a = Root THEN "running" ELSE "absent"]
    /\ authority  = [a \in Agents |-> IF a = Root THEN RootAuthority ELSE NoAuthority]
    /\ parent     = [a \in Agents |-> NoAgent]
    /\ depth      = [a \in Agents |-> 0]
    /\ name       = [a \in Agents |-> NoName]
    /\ seq        = [a \in Agents |-> 0]
    /\ gen        = [a \in Agents |-> 0]
    /\ worktree   = [a \in Agents |-> NoWorktree]
    /\ wtState    = [a \in Agents |-> "none"]
    /\ clean      = [a \in Agents |-> FALSE]
    /\ effect     = [a \in Agents |-> "idle"]
    /\ effectGen  = [a \in Agents |-> 0]
    /\ terminal   = [a \in Agents |-> "none"]
    /\ stale      = [a \in Agents |-> FALSE]
    /\ nextSeq    = 0

\* ---------------------------------------------------------------------------
\* Guards (one per action; shared by the action and the trace validator)
\* ---------------------------------------------------------------------------

Present(a) == status[a] # "absent"

\* The direct children of an agent. Used by the cancellation guard: a child
\* session cannot outlive the session that spawned it.
Children(p) == {c \in Agents : Present(c) /\ parent[c] = p}

\* The *live* direct children: a session may settle or be reconciled once none
\* of its children is still dispatched or running. Settled child records stay
\* in the tree until they are separately cleared.
LiveChildren(p) == {c \in Agents : Present(c) /\ parent[c] = p /\ status[c] \in {"dispatched", "running"}}

\* The child to dispatch must be absent, may not be the root, the name and the
\* reserved worktree must be free among present agents, and the depth bound must
\* hold. Attenuation is a guard, not a fixup: a dispatcher can only hand a child
\* the `spawn` and `grant` bits it itself was allowed to hand out.
GuardDispatch(d, c, n, w, auth) ==
    /\ d \in Agents /\ c \in Agents /\ d # c
    /\ ChildOf(c)
    /\ status[d] = "running"
    /\ ~stale[d]
    /\ status[c] = "absent"
    /\ authority[d].spawn
    /\ auth \in Authorities
    /\ auth.spawn => authority[d].grant
    /\ auth.grant => authority[d].grant
    /\ auth.grant => auth.spawn
    /\ n \in Names
    /\ \A x \in Agents : Present(x) => name[x] # n
    /\ (w \in Worktrees \/ w = NoWorktree)
    /\ (w = NoWorktree \/ (\A x \in Agents : Present(x) => worktree[x] # w))
    /\ depth[d] + 1 <= MaxDepth
    /\ gen[c] < MaxGen
    /\ nextSeq < MaxSeq

GuardAddWorktree(c) ==
    /\ Present(c)
    /\ ~stale[c]
    /\ status[c] = "dispatched"
    /\ wtState[c] = "declared"
    /\ worktree[c] # NoWorktree

GuardAdmit(c) ==
    /\ ChildOf(c)
    /\ ~stale[c]
    /\ status[c] = "dispatched"
    /\ effect[c] = "idle"
    /\ (worktree[c] = NoWorktree \/ wtState[c] = "created")

\* A live effect of the current generation, with no live child: a child session
\* settles only after its own children are gone (the runtime cancels them
\* during session shutdown). A settle after the fence moved (cancel bumped the
\* generation) is not enabled; the effect is already dropped.
GuardLive(c) ==
    /\ ChildOf(c)
    /\ status[c] = "running"
    /\ effect[c] = "live"
    /\ effectGen[c] = gen[c]
    /\ LiveChildren(c) = {}
    /\ ~stale[c]

GuardComplete(c) == GuardLive(c)
GuardFail(c) == GuardLive(c)

\* Cancellation is depth-first: a child is cancelled only after its own
\* children are gone, so the runtime cascade (session shutdown cancels the
\* grandchildren) is reflected in the model rather than assumed.
GuardCancel(c) ==
    /\ ChildOf(c)
    /\ status[c] \in {"dispatched", "running"}
    /\ gen[c] < MaxGen
    /\ LiveChildren(c) = {}
    /\ ~stale[c]

GuardProbeWorktree(c) ==
    /\ ChildOf(c)
    /\ wtState[c] = "created"

GuardRemoveWorktree(c) ==
    /\ ChildOf(c)
    /\ wtState[c] = "created"
    /\ clean[c]
    /\ status[c] = "settled"

\* Recovery of a reservation made before a crash: the directory may or may not
\* have been created. Both outcomes are environment transitions.
GuardWorktreeFound(c) ==
    /\ ChildOf(c)
    /\ (stale[c] \/ status[c] = "settled")
    /\ wtState[c] = "declared"
    /\ worktree[c] # NoWorktree

GuardWorktreeLost(c) ==
    /\ ChildOf(c)
    /\ (stale[c] \/ status[c] = "settled")
    /\ wtState[c] = "declared"
    /\ worktree[c] # NoWorktree

GuardReconcile(c) ==
    /\ ChildOf(c)
    /\ stale[c]
    /\ effect[c] = "idle"
    /\ LiveChildren(c) = {}

GuardClear(c) ==
    /\ ChildOf(c)
    /\ status[c] = "settled"
    /\ effect[c] = "idle"
    /\ ~stale[c]
    /\ wtState[c] \in {"none", "removed"}
    /\ \A x \in Agents : parent[x] = c => status[x] = "absent"

\* ---------------------------------------------------------------------------
\* Actions
\* ---------------------------------------------------------------------------

Dispatch(d, c, n, w, auth) ==
    /\ GuardDispatch(d, c, n, w, auth)
    /\ status'    = [status EXCEPT ![c] = "dispatched"]
    /\ authority' = [authority EXCEPT ![c] = auth]
    /\ parent'    = [parent EXCEPT ![c] = d]
    /\ depth'     = [depth EXCEPT ![c] = depth[d] + 1]
    /\ name'      = [name EXCEPT ![c] = n]
    /\ seq'       = [seq EXCEPT ![c] = nextSeq]
    /\ gen'       = [gen EXCEPT ![c] = gen[c] + 1]
    /\ worktree'  = [worktree EXCEPT ![c] = w]
    /\ wtState'   = [wtState EXCEPT ![c] = IF w = NoWorktree THEN "none" ELSE "declared"]
    /\ clean'     = [clean EXCEPT ![c] = FALSE]
    /\ effect'    = [effect EXCEPT ![c] = "idle"]
    /\ effectGen' = [effectGen EXCEPT ![c] = 0]
    /\ terminal'  = [terminal EXCEPT ![c] = "none"]
    /\ stale'     = [stale EXCEPT ![c] = FALSE]
    /\ nextSeq'   = nextSeq + 1

AddWorktree(c) ==
    /\ GuardAddWorktree(c)
    /\ wtState' = [wtState EXCEPT ![c] = "created"]
    /\ UNCHANGED << status, authority, parent, depth, name, seq, gen,
                    worktree, clean, effect, effectGen, terminal, stale, nextSeq >>

Admit(c) ==
    /\ GuardAdmit(c)
    /\ status'    = [status EXCEPT ![c] = "running"]
    /\ effect'    = [effect EXCEPT ![c] = "live"]
    /\ effectGen' = [effectGen EXCEPT ![c] = gen[c]]
    /\ UNCHANGED << authority, parent, depth, name, seq, gen,
                    worktree, wtState, clean, terminal, stale, nextSeq >>

Complete(c) ==
    /\ GuardComplete(c)
    /\ status'   = [status EXCEPT ![c] = "settled"]
    /\ effect'   = [effect EXCEPT ![c] = "idle"]
    /\ terminal' = [terminal EXCEPT ![c] = "completed"]
    /\ UNCHANGED << authority, parent, depth, name, seq, gen,
                    worktree, wtState, clean, effectGen, stale, nextSeq >>

Fail(c) ==
    /\ GuardFail(c)
    /\ status'   = [status EXCEPT ![c] = "settled"]
    /\ effect'   = [effect EXCEPT ![c] = "idle"]
    /\ terminal' = [terminal EXCEPT ![c] = "failed"]
    /\ UNCHANGED << authority, parent, depth, name, seq, gen,
                    worktree, wtState, clean, effectGen, stale, nextSeq >>

Cancel(c) ==
    /\ GuardCancel(c)
    /\ status'   = [status EXCEPT ![c] = "settled"]
    /\ effect'   = [effect EXCEPT ![c] = "idle"]
    /\ terminal' = [terminal EXCEPT ![c] = "cancelled"]
    /\ gen'      = [gen EXCEPT ![c] = gen[c] + 1]
    /\ UNCHANGED << authority, parent, depth, name, seq,
                    worktree, wtState, clean, effectGen, stale, nextSeq >>

ProbeWorktree(c, healthy) ==
    /\ GuardProbeWorktree(c)
    /\ clean' = [clean EXCEPT ![c] = healthy]
    /\ UNCHANGED << status, authority, parent, depth, name, seq, gen,
                    worktree, wtState, effect, effectGen, terminal, stale, nextSeq >>

RemoveWorktree(c) ==
    /\ GuardRemoveWorktree(c)
    /\ wtState' = [wtState EXCEPT ![c] = "removed"]
    /\ UNCHANGED << status, authority, parent, depth, name, seq, gen,
                    worktree, clean, effect, effectGen, terminal, stale, nextSeq >>

WorktreeFound(c) ==
    /\ GuardWorktreeFound(c)
    /\ wtState' = [wtState EXCEPT ![c] = "created"]
    /\ UNCHANGED << status, authority, parent, depth, name, seq, gen,
                    worktree, clean, effect, effectGen, terminal, stale, nextSeq >>

WorktreeLost(c) ==
    /\ GuardWorktreeLost(c)
    /\ wtState' = [wtState EXCEPT ![c] = "none"]
    /\ worktree' = [worktree EXCEPT ![c] = NoWorktree]
    /\ UNCHANGED << status, authority, parent, depth, name, seq, gen,
                    clean, effect, effectGen, terminal, stale, nextSeq >>

\* A pi process death: every live effect is gone and every non-settled child
\* owes a reconciliation.
PiCrash ==
    /\ status' = status
    /\ authority' = authority
    /\ parent' = parent
    /\ depth' = depth
    /\ name' = name
    /\ seq' = seq
    /\ gen' = gen
    /\ worktree' = worktree
    /\ wtState' = wtState
    /\ clean' = clean
    /\ effectGen' = effectGen
    /\ terminal' = terminal
    /\ nextSeq' = nextSeq
    /\ effect' = [a \in Agents |->
                    IF Present(a) /\ a # Root /\ status[a] \in {"dispatched", "running"}
                    THEN "idle" ELSE effect[a]]
    /\ stale'  = [a \in Agents |->
                    IF Present(a) /\ a # Root /\ status[a] \in {"dispatched", "running"}
                    THEN TRUE ELSE stale[a]]

Reconcile(c) ==
    /\ GuardReconcile(c)
    /\ status'   = [status EXCEPT ![c] = "settled"]
    /\ terminal' = [terminal EXCEPT ![c] = "lost"]
    /\ stale'    = [stale EXCEPT ![c] = FALSE]
    /\ UNCHANGED << authority, parent, depth, name, seq, gen,
                    worktree, wtState, clean, effect, effectGen, nextSeq >>

Clear(c) ==
    /\ GuardClear(c)
    /\ status'    = [status EXCEPT ![c] = "absent"]
    /\ authority' = [authority EXCEPT ![c] = NoAuthority]
    /\ parent'    = [parent EXCEPT ![c] = NoAgent]
    /\ depth'     = [depth EXCEPT ![c] = 0]
    /\ name'      = [name EXCEPT ![c] = NoName]
    /\ seq'       = [seq EXCEPT ![c] = 0]
    /\ gen'       = [gen EXCEPT ![c] = 0]
    /\ worktree'  = [worktree EXCEPT ![c] = NoWorktree]
    /\ wtState'   = [wtState EXCEPT ![c] = "none"]
    /\ clean'     = [clean EXCEPT ![c] = FALSE]
    /\ effect'    = [effect EXCEPT ![c] = "idle"]
    /\ effectGen' = [effectGen EXCEPT ![c] = 0]
    /\ terminal'  = [terminal EXCEPT ![c] = "none"]
    /\ stale'     = [stale EXCEPT ![c] = FALSE]
    /\ UNCHANGED nextSeq

Next ==
    \/ PiCrash
    \/ \E d, c \in Agents, n \in Names, w \in Worktrees \cup {NoWorktree},
          auth \in Authorities :
         Dispatch(d, c, n, w, auth)

    \/ \E c \in Agents :
         \/ AddWorktree(c) \/ Admit(c) \/ Complete(c) \/ Fail(c)
         \/ Cancel(c) \/ RemoveWorktree(c) \/ WorktreeFound(c)
         \/ WorktreeLost(c) \/ Reconcile(c) \/ Clear(c)
         \/ \E healthy \in BOOLEAN : ProbeWorktree(c, healthy)

\* Fairness: a live child eventually settles or is reconciled; a clean worktree
\* of a settled child is eventually removed. The one environment assumption is
\* that the child session terminates.
SettleAny == \E c \in Agents : Complete(c) \/ Fail(c) \/ Cancel(c)
CleanupAny == \E c \in Agents : RemoveWorktree(c)
ReconcileAny == \E c \in Agents : Reconcile(c)

SafetySpec == Init /\ [][Next]_vars

Spec ==
    Init /\ [][Next]_vars
    /\ WF_vars(SettleAny)
    /\ WF_vars(CleanupAny)
    /\ WF_vars(ReconcileAny)

\* ---------------------------------------------------------------------------
\* Safety invariants
\* ---------------------------------------------------------------------------

TypeOK ==
    /\ status    \in [Agents -> Statuses]
    /\ authority \in [Agents -> Authorities]
    /\ parent    \in [Agents -> Agents \cup {NoAgent}]
    /\ depth     \in [Agents -> 0..MaxDepth]
    /\ name      \in [Agents -> Names \cup {NoName}]
    /\ seq       \in [Agents -> 0..MaxSeq]
    /\ gen       \in [Agents -> 0..MaxGen]
    /\ worktree  \in [Agents -> Worktrees \cup {NoWorktree}]
    /\ wtState   \in [Agents -> WorktreeStates]
    /\ clean     \in [Agents -> BOOLEAN]
    /\ effect    \in [Agents -> Effects]
    /\ effectGen \in [Agents -> 0..MaxGen]
    /\ terminal  \in [Agents -> Terminals]
    /\ stale     \in [Agents -> BOOLEAN]
    /\ nextSeq   \in 0..MaxSeq

\* The root is always the running dispatcher with full authority.
RootFixed ==
    /\ status[Root] = "running"
    /\ parent[Root] = NoAgent
    /\ depth[Root] = 0
    /\ name[Root] = NoName
    /\ worktree[Root] = NoWorktree
    /\ effect[Root] = "idle"
    /\ terminal[Root] = "none"
    /\ authority[Root] = RootAuthority

\* Every present child hangs off a present parent at exactly one more depth.
TreeShape ==
    \A a \in Agents :
        Present(a) /\ ChildOf(a) =>
            /\ parent[a] # NoAgent
            /\ Present(parent[a])
            /\ depth[a] = depth[parent[a]] + 1

DepthBound ==
    \A a \in Agents : Present(a) => depth[a] <= MaxDepth

\* Authority never escalates: a child holds only bits its dispatcher held, and
\* `grant` is meaningless without `spawn`.
AuthorityAttenuation ==
    \A a \in Agents :
        Present(a) /\ ChildOf(a) =>
            /\ (authority[a].spawn => authority[parent[a]].grant)
            /\ (authority[a].grant => authority[parent[a]].grant)
            /\ (authority[a].grant => authority[a].spawn)

\* Identity: a present child has a real name, and no two present agents share
\* one. The root has no name of its own.
NameUnique ==
    /\ \A a \in Agents : Present(a) /\ ChildOf(a) => name[a] # NoName
    /\ \A a, b \in Agents : Present(a) /\ Present(b) /\ a # b => name[a] # name[b]

\* Worktrees are exclusive among present agents.
WorktreeUnique ==
    \A a, b \in Agents :
        Present(a) /\ Present(b) /\ a # b /\ worktree[a] # NoWorktree =>
            worktree[b] # worktree[a]

\* A declared, created, or removed worktree always carries its path; an absent
\* agent and the root carry none.
WorktreeDeclared ==
    \A a \in Agents :
        /\ (wtState[a] # "none" => worktree[a] # NoWorktree)
        /\ (worktree[a] = NoWorktree => wtState[a] = "none")
        /\ (a = Root => worktree[a] = NoWorktree)
        /\ (status[a] = "absent" => worktree[a] = NoWorktree)

\* A live effect belongs to a running child of the current generation.
EffectCurrent ==
    \A a \in Agents : effect[a] = "live" => (status[a] = "running" /\ effectGen[a] = gen[a])

EffectIdleOutsideRunning ==
    \A a \in Agents : status[a] # "running" => effect[a] = "idle"

\* A settled child carries exactly one terminal outcome; a live one carries none.
TerminalSound ==
    \A a \in Agents :
        (status[a] = "settled") <=> (terminal[a] # "none")

\* A damaged worktree is only ever removed after the child stopped.
WorktreeRemovalSound ==
    \A a \in Agents : wtState[a] = "removed" => status[a] = "settled"

CleanSound ==
    \A a \in Agents : clean[a] => wtState[a] \in {"created", "removed"}

\* Presentation order over children: sequence numbers are assigned once and
\* stay unique.
SeqUnique ==
    \A a, b \in Agents :
        Present(a) /\ Present(b) /\ ChildOf(a) /\ ChildOf(b) /\ a # b => seq[a] # seq[b]

SeqBound ==
    \A a \in Agents : Present(a) /\ ChildOf(a) => seq[a] < nextSeq

\* A live child can only exist under a running parent.
LiveChildRunningParent ==
    \A a \in Agents :
        Present(a) /\ ChildOf(a) /\ status[a] \in {"dispatched", "running"} =>
            status[parent[a]] = "running"

\* Cancellation is depth-first: no live direct child remains when a child is
\* cancelled. The recursive closure to all descendants is `CancelCascade` in
\* `SubagentView.tla`, checked by TLC over the reachable space.
CancelledNoLiveChild ==
    \A a \in Agents :
        terminal[a] = "cancelled" =>
            \A x \in Agents : parent[x] = a => status[x] \in {"absent", "settled"}

\* A stale record was invalidated by a crash and is not yet reconciled.
StaleSound ==
    \A a \in Agents : stale[a] => Present(a) /\ ChildOf(a)

CoreInv ==
    /\ TypeOK
    /\ RootFixed
    /\ TreeShape
    /\ DepthBound
    /\ AuthorityAttenuation
    /\ NameUnique
    /\ WorktreeUnique
    /\ WorktreeDeclared
    /\ EffectCurrent
    /\ EffectIdleOutsideRunning
    /\ TerminalSound
    /\ WorktreeRemovalSound
    /\ CleanSound
    /\ SeqUnique
    /\ SeqBound
    /\ LiveChildRunningParent
    /\ CancelledNoLiveChild
    /\ StaleSound

\* ---------------------------------------------------------------------------
\* Liveness
\* ---------------------------------------------------------------------------

\* A running child eventually leaves `running` (settles or is reconciled). The
\* root is the dispatcher itself and stays running by `RootFixed`.
EffectsTerminate ==
    \A a \in Agents :
        ChildOf(a) /\ (status[a] = "running") ~> (status[a] # "running")

\* A clean worktree of a settled child is eventually either removed or found
\* dirty; an adversarial probe cannot leave it clean forever without removal.
WorktreesTerminate ==
    \A a \in Agents :
        (status[a] = "settled" /\ wtState[a] = "created" /\ clean[a]) ~>
            (wtState[a] = "removed" \/ ~clean[a])

\* A crashed child record is eventually reconciled to `lost`.
ReconciliationsLand ==
    \A a \in Agents : stale[a] ~> (terminal[a] = "lost")

Liveness == EffectsTerminate /\ WorktreesTerminate /\ ReconciliationsLand

=============================================================================
