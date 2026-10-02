---------------- MODULE SubagentViewProof ----------------
EXTENDS SubagentView, NaturalsInduction, TLAPS
THEOREM LivePath ==
  ASSUME CoreInv, MaxDepth \in Nat, NEW n \in Nat, NEW p \in [1..n -> Agents],
         ParentPath(p,n), status[p[1]] \in {"dispatched","running"}
  PROVE status[p[n]] = "running"
  <1>1. DEFINE P(k) == k \in 1..n => status[p[k]] \in {"dispatched","running"}
  <1>2. P(0) BY SMT DEF P
  <1>3. \A k \in Nat: P(k) => P(k+1)
    BY SMT DEF P, ParentPath, CoreInv, LiveChildRunningParent
  <1>4. \A k \in Nat: P(k) BY ONLY <1>2, <1>3, IsaM("(intro natInduct, auto)")
  <1>5. n-1 \in 1..n /\ n-1 \in Nat /\ p[n-1] \in Agents
    BY SMT DEF ParentPath
  <1>6. status[p[n-1]] \in {"dispatched","running"}
    BY <1>4, <1>5, SMT DEF P
  <1>7. QED BY <1>5, <1>6, SMT DEF ParentPath, CoreInv, LiveChildRunningParent
THEOREM CoreImpliesViews ==
  ASSUME MaxDepth \in Nat
  PROVE CoreInv => ViewInv /\ LiveAncestorsRunning
  <1>1. CoreInv => LiveAncestorsRunning
    BY LivePath, SMT DEF LiveAncestorsRunning, PresentAgents, Ancestors, Descendants, ParentPath
  <1>2. CoreInv => CancelCascade
    <2>1. SUFFICES ASSUME CoreInv, NEW a \in Agents, terminal[a] = "cancelled",
                         NEW x \in Descendants(a)
                   PROVE status[x] \in {"absent","settled"}
      BY DEF CancelCascade
    <2>2. PICK n, p: n \in 2..(MaxDepth+1) /\ p \in [1..n -> Agents]
      /\ ParentPath(p,n) /\ p[1] = x /\ p[n] = a
      BY <2>1 DEF Descendants
    <2>3. n \in Nat /\ x \in Agents BY <2>1, <2>2, SMT DEF Descendants
    <2>4. status[x] \in {"dispatched","running"} => status[a] = "running"
      BY <2>1, <2>2, <2>3, LivePath
    <2>5. QED BY <2>1, <2>3, <2>4, SMT DEF CoreInv, TypeOK, Statuses, TerminalSound
  <1>3. CoreInv => PresentationTotal
    <2>1. SUFFICES ASSUME CoreInv, NEW a \in PresentAgents PROVE RowToken(a) # "absent"
      BY DEF PresentationTotal
    <2>2. status[a] \in {"dispatched","running","settled"} /\ terminal[a] \in Terminals
      BY <2>1, SMT DEF CoreInv, TypeOK, Statuses, PresentAgents, Present
    <2>3. CASE status[a] = "dispatched"
      BY <2>1, <2>2, <2>3, SMT DEF RowToken, CoreInv, TerminalSound, PresentAgents
    <2>4. CASE status[a] = "running"
      BY <2>1, <2>2, <2>4, SMT DEF RowToken, CoreInv, TerminalSound, PresentAgents
    <2>5. CASE status[a] = "settled"
      BY <2>1, <2>2, <2>5, SMT DEF RowToken, CoreInv, TerminalSound, PresentAgents, Terminals
    <2>6. QED BY <2>2, <2>3, <2>4, <2>5, SMT
  <1>4. QED BY <1>1, <1>2, <1>3, SMT DEF ViewInv
=============================================================================
