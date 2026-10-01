--------------------------- MODULE SubagentView ---------------------------
\* The presentation view of the verified subagent machine.
\*
\* Everything the tool renders is a total function of the core state: the
\* lifecycle (`status`/`terminal`), the tree (`parent`/`depth`), the identity
\* (`name`/`seq`), the authority bits, and the worktree lifecycle. Nothing here
\* re-derives lifecycle state from text or from the runtime; the task and the
\* report are opaque payload and never appear in a guard.
\*
\* This module adds the recursive closure of the cancellation cascade and the
\* definitional presentation properties to `CoreInv`. They are checked by TLC
\* over every reachable state. It is a separate module because the recursion
\* (`Descendants`) cannot be elaborated by TLAPS; the inductive proof extends
\* the recursion-free machine.
\* -------------------------------------------------------------------------

EXTENDS SubagentSystem, FiniteSets, TLC

\* Every present child, in the root's tree.
PresentAgents == {a \in Agents : Present(a) /\ ChildOf(a)}

\* The transitive closure of `parent`, at the current state.
RECURSIVE Descendants(_)
Descendants(a) ==
    LET kids == {x \in Agents : Present(x) /\ parent[x] = a}
    IN kids \cup UNION {Descendants(c) : c \in kids}

\* The tool exists exactly for an agent with `spawn` authority. The runtime
\* enforces the same rule by deactivating the tool before prompting.
HasTool(a) == Present(a) /\ ChildOf(a) /\ authority[a].spawn
MayGrant(a) == HasTool(a) /\ authority[a].grant

\* The full recursive cancellation law: once an agent is cancelled, its whole
\* subtree is gone (settled or absent). `CancelledNoLiveChild` in the machine
\* is the inductive one-level form.
CancelCascade ==
    \A a \in Agents :
        terminal[a] = "cancelled" =>
            \A x \in Descendants(a) : status[x] \in {"absent", "settled"}

\* The ancestor chain of an agent, root excluded.
RECURSIVE Ancestors(_)
Ancestors(a) ==
    IF a = Root \/ parent[a] = NoAgent \/ ~Present(a)
    THEN {}
    ELSE {parent[a]} \cup Ancestors(parent[a])

\* A live agent's whole ancestor chain is running.
LiveAncestorsRunning ==
    \A a \in PresentAgents :
        status[a] \in {"dispatched", "running"} =>
            \A x \in Ancestors(a) : status[x] = "running"

\* Presentation order is exactly ascending `seq` over present children.
Rank(a) == Cardinality({b \in Agents : Present(b) /\ ChildOf(b) /\ seq[b] < seq[a]})

Earlier(a, b) ==
    Present(a) /\ Present(b) /\ ChildOf(a) /\ ChildOf(b) /\ seq[a] < seq[b]

\* The row token is a total function of the lifecycle state: the status while
\* the child is live, the terminal once settled. This is the only mapping the
\* widget and the tool consume; the glyph itself is a renderer choice.
RowToken(a) ==
    CASE status[a] = "absent"                       -> "absent"
      [] status[a] = "dispatched"                   -> "queued"
      [] status[a] = "running"                      -> "running"
      [] terminal[a] = "completed"                  -> "completed"
      [] terminal[a] = "failed"                     -> "failed"
      [] terminal[a] = "cancelled"                  -> "cancelled"
      [] terminal[a] = "lost"                       -> "lost"
      [] OTHER                                      -> "absent"

\* The authority token the dispatcher sees when choosing what to hand down.
AuthorityToken(auth) ==
    CASE auth = [spawn |-> FALSE, grant |-> FALSE] -> "none"
      [] auth = [spawn |-> TRUE,  grant |-> FALSE] -> "spawn"
      [] auth = [spawn |-> TRUE,  grant |-> TRUE]  -> "spawn+grant"
      [] OTHER                                     -> "none"

\* A dispatcher may hand a child exactly the authorities it can attenuate to.
Attenuable(d, auth) ==
    HasTool(d) /\
    (auth.spawn => authority[d].grant) /\
    (auth.grant => authority[d].grant) /\
    (auth.grant => auth.spawn)

\* Every present child has a token from the total function above.
PresentationTotal ==
    \A a \in PresentAgents : RowToken(a) # "absent"

ViewInv == CoreInv /\ CancelCascade /\ PresentationTotal

=============================================================================
