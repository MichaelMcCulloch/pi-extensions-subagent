---------------- MODULE TraceValidation ----------------
EXTENDS SubagentView, TracesData, Sequences
VARIABLES traceNo, traceIndex, error
Trace == Traces[traceNo]
state == [status |-> status, authority |-> authority, parent |-> parent, depth |-> depth, name |-> name, seq |-> seq, gen |-> gen, worktree |-> worktree, wtState |-> wtState, clean |-> clean, effect |-> effect, effectGen |-> effectGen, terminal |-> terminal, stale |-> stale, nextSeq |-> nextSeq]
ActionOf(ev) ==
    \/ (ev.type = "Dispatch" /\ Dispatch(ev.d, ev.c, ev.n, ev.w, ev.auth))
    \/ (ev.type = "AddWorktree" /\ AddWorktree(ev.c))
    \/ (ev.type = "Admit" /\ Admit(ev.c))
    \/ (ev.type = "Complete" /\ Complete(ev.c))
    \/ (ev.type = "Fail" /\ Fail(ev.c))
    \/ (ev.type = "Cancel" /\ Cancel(ev.c))
    \/ (ev.type = "ProbeWorktree" /\ ProbeWorktree(ev.c, ev.healthy))
    \/ (ev.type = "RemoveWorktree" /\ RemoveWorktree(ev.c))
    \/ (ev.type = "WorktreeFound" /\ WorktreeFound(ev.c))
    \/ (ev.type = "WorktreeLost" /\ WorktreeLost(ev.c))
    \/ (ev.type = "PiCrash" /\ PiCrash)
    \/ (ev.type = "Reconcile" /\ Reconcile(ev.c))
    \/ (ev.type = "Clear" /\ Clear(ev.c))
GuardOf(ev) ==
    \/ (ev.type = "Dispatch" /\ GuardDispatch(ev.d, ev.c, ev.n, ev.w, ev.auth))
    \/ (ev.type = "AddWorktree" /\ GuardAddWorktree(ev.c))
    \/ (ev.type = "Admit" /\ GuardAdmit(ev.c))
    \/ (ev.type = "Complete" /\ GuardComplete(ev.c))
    \/ (ev.type = "Fail" /\ GuardFail(ev.c))
    \/ (ev.type = "Cancel" /\ GuardCancel(ev.c))
    \/ (ev.type = "ProbeWorktree" /\ GuardProbeWorktree(ev.c))
    \/ (ev.type = "RemoveWorktree" /\ GuardRemoveWorktree(ev.c))
    \/ (ev.type = "WorktreeFound" /\ GuardWorktreeFound(ev.c))
    \/ (ev.type = "WorktreeLost" /\ GuardWorktreeLost(ev.c))
    \/ (ev.type = "PiCrash" /\ TRUE)
    \/ (ev.type = "Reconcile" /\ GuardReconcile(ev.c))
    \/ (ev.type = "Clear" /\ GuardClear(ev.c))
TraceInit ==
    /\ traceNo \in 1..Len(Traces)
    /\ traceIndex = 1
    /\ error = FALSE
    /\ Init
TraceStep ==
    LET ev == Trace[traceIndex + 1].event IN
      \/ (GuardOf(ev) /\ ActionOf(ev) /\ UNCHANGED error)
      \/ (~GuardOf(ev) /\ UNCHANGED vars /\ error' = TRUE)
TraceNext ==
    \/ /\ traceIndex < Len(Trace)
       /\ TraceStep
       /\ traceIndex' = traceIndex + 1
       /\ UNCHANGED traceNo
    \/ /\ traceIndex = Len(Trace)
       /\ UNCHANGED <<vars, traceNo, traceIndex, error>>
TraceSpec == TraceInit /\ [][TraceNext]_<<vars, traceNo, traceIndex, error>>
TraceInv == /\ ~error
            /\ state = Trace[traceIndex].state
            /\ ViewInv
================================================================
