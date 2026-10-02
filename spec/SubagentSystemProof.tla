---------------- MODULE SubagentSystemProof ----------------
\* Generated; the driver checks every imported proof module before this assembly.
EXTENDS SubagentInitProof, SubagentDispatchCoreProof, SubagentAddWorktreeCoreProof, SubagentAdmitCoreProof, SubagentCompleteCoreProof, SubagentFailCoreProof, SubagentCancelCoreProof, SubagentProbeWorktreeCoreProof, SubagentRemoveWorktreeCoreProof, SubagentWorktreeFoundCoreProof, SubagentWorktreeLostCoreProof, SubagentReconcileCoreProof, SubagentClearCoreProof, SubagentPiCrashCoreProof, SubagentUnchangedCoreProof, SubagentViewProof

THEOREM NextCore ==
  ASSUME Root \in Agents,
           MaxDepth \in Nat, MaxGen \in Nat, MaxSeq \in Nat,
           NoAgent \notin Agents, NoName \notin Names, NoWorktree \notin Worktrees
  PROVE CoreInv /\ [Next]_vars => CoreInv'
  BY DispatchCore, AddWorktreeCore, AdmitCore, CompleteCore, FailCore, CancelCore, ProbeWorktreeCore, RemoveWorktreeCore, WorktreeFoundCore, WorktreeLostCore, ReconcileCore, ClearCore, PiCrashCore, UnchangedCore DEF Next, vars

THEOREM SafetyCore ==
  ASSUME Root \in Agents,
           MaxDepth \in Nat, MaxGen \in Nat, MaxSeq \in Nat,
           NoAgent \notin Agents, NoName \notin Names, NoWorktree \notin Worktrees
  PROVE SafetySpec => []CoreInv
  BY InitCore, NextCore, PTL DEF SafetySpec

THEOREM SafetyViews ==
  ASSUME Root \in Agents, MaxDepth \in Nat, MaxGen \in Nat, MaxSeq \in Nat,
         NoAgent \notin Agents, NoName \notin Names, NoWorktree \notin Worktrees
  PROVE SafetySpec => [](ViewInv /\ LiveAncestorsRunning)
  BY SafetyCore, CoreImpliesViews, PTL

=========================================================================
