/** Executable transcription of SubagentSystem.tla. Payload never enters guards. */
export type AgentId = string;
export type AgentStatus = 'absent' | 'dispatched' | 'running' | 'settled';
export type Terminal = 'none' | 'completed' | 'failed' | 'cancelled' | 'lost';
export type WorktreeState = 'none' | 'declared' | 'created' | 'removed';
export type EffectState = 'idle' | 'live';
export interface Authority { spawn: boolean; grant: boolean }
export interface SubagentModelConfig {
  agents: readonly string[]; root: string; names: readonly string[]; worktrees: readonly string[];
  maxDepth: number; maxGen: number; maxSeq: number;
  noAgent: string; noName: string; noWorktree: string;
}
export const SUBAGENT_MODEL: SubagentModelConfig = {
  agents: ['r', 'a1', 'a2'], root: 'r', names: ['n1', 'n2'], worktrees: ['w1', 'w2'],
  maxDepth: 2, maxGen: 2, maxSeq: 3, noAgent: '<no-agent>', noName: '<no-name>', noWorktree: '<no-worktree>',
};
export interface AbstractSubagentState {
  status: Record<string, AgentStatus>; authority: Record<string, Authority>; parent: Record<string, string>;
  depth: Record<string, number>; name: Record<string, string>; seq: Record<string, number>; gen: Record<string, number>;
  worktree: Record<string, string>; wtState: Record<string, WorktreeState>; clean: Record<string, boolean>;
  effect: Record<string, EffectState>; effectGen: Record<string, number>; terminal: Record<string, Terminal>;
  stale: Record<string, boolean>; nextSeq: number;
}
export const SUBAGENT_ACTIONS = ['Dispatch', 'AddWorktree', 'Admit', 'Complete', 'Fail', 'Cancel', 'ProbeWorktree', 'RemoveWorktree', 'WorktreeFound', 'WorktreeLost', 'PiCrash', 'Reconcile', 'Clear'] as const;
export type SubagentEvent =
  | { type: 'Dispatch'; d: string; c: string; n: string; w: string; auth: Authority }
  | { type: 'ProbeWorktree'; c: string; healthy: boolean }
  | { type: 'PiCrash' }
  | { type: Exclude<typeof SUBAGENT_ACTIONS[number], 'Dispatch' | 'ProbeWorktree' | 'PiCrash'>; c: string };
export class SubagentStateError extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'SubagentStateError'; }
}
export function initAbstractSubagentState(m = SUBAGENT_MODEL): AbstractSubagentState {
  const map = <T>(f: (a: string) => T): Record<string, T> => Object.fromEntries(m.agents.map(a => [a, f(a)]));
  return {
    status: map(a => a === m.root ? 'running' : 'absent'), authority: map(a => ({ spawn: a === m.root, grant: a === m.root })),
    parent: map(() => m.noAgent), depth: map(() => 0), name: map(() => m.noName), seq: map(() => 0), gen: map(() => 0),
    worktree: map(() => m.noWorktree), wtState: map(() => 'none'), clean: map(() => false), effect: map(() => 'idle'),
    effectGen: map(() => 0), terminal: map(() => 'none'), stale: map(() => false), nextSeq: 0,
  };
}
export const present = (s: AbstractSubagentState, a: string): boolean => s.status[a] !== undefined && s.status[a] !== 'absent';
export const live = (s: AbstractSubagentState, a: string): boolean => s.status[a] === 'dispatched' || s.status[a] === 'running';
export const children = (s: AbstractSubagentState, m: SubagentModelConfig, a: string): string[] => m.agents.filter(c => present(s, c) && s.parent[c] === a);
const noLiveChildren = (s: AbstractSubagentState, m: SubagentModelConfig, a: string): boolean => !children(s, m, a).some(c => live(s, c));
export const attenuates = (parent: Authority, child: Authority): boolean => (!child.spawn || parent.grant) && (!child.grant || parent.grant) && (!child.grant || child.spawn);
type Guard = (s: AbstractSubagentState, m: SubagentModelConfig, e: SubagentEvent) => boolean;
const child = (m: SubagentModelConfig, e: SubagentEvent): e is Exclude<SubagentEvent, {type: 'PiCrash'}> => e.type !== 'PiCrash' && m.agents.includes(e.c) && e.c !== m.root;
const guardLive: Guard = (s, m, e) => child(m, e) && s.status[e.c] === 'running' && s.effect[e.c] === 'live' && s.effectGen[e.c] === s.gen[e.c] && noLiveChildren(s, m, e.c) && !s.stale[e.c];
const guardFound: Guard = (s, m, e) => child(m, e) && (s.stale[e.c] === true || s.status[e.c] === 'settled') && s.wtState[e.c] === 'declared' && s.worktree[e.c] !== m.noWorktree;
export const guards: Record<SubagentEvent['type'], Guard> = {
  Dispatch: (s, m, e) => e.type === 'Dispatch' && child(m, e) && m.agents.includes(e.d) && e.d !== e.c && s.status[e.d] === 'running' && !s.stale[e.d] && s.status[e.c] === 'absent' && s.authority[e.d]?.spawn === true && typeof e.auth.spawn === 'boolean' && typeof e.auth.grant === 'boolean' && attenuates(s.authority[e.d]!, e.auth) && m.names.includes(e.n) && m.agents.every(x => !present(s, x) || s.name[x] !== e.n) && (e.w === m.noWorktree || (m.worktrees.includes(e.w) && m.agents.every(x => !present(s, x) || s.worktree[x] !== e.w))) && s.depth[e.d]! + 1 <= m.maxDepth && s.gen[e.c]! < m.maxGen && s.nextSeq < m.maxSeq,
  AddWorktree: (s, m, e) => e.type !== 'PiCrash' && m.agents.includes(e.c) && present(s, e.c) && !s.stale[e.c] && s.status[e.c] === 'dispatched' && s.wtState[e.c] === 'declared' && s.worktree[e.c] !== m.noWorktree,
  Admit: (s, m, e) => child(m, e) && !s.stale[e.c] && s.status[e.c] === 'dispatched' && s.effect[e.c] === 'idle' && (s.worktree[e.c] === m.noWorktree || s.wtState[e.c] === 'created'),
  Complete: guardLive, Fail: guardLive,
  Cancel: (s, m, e) => child(m, e) && live(s, e.c) && s.gen[e.c]! < m.maxGen && noLiveChildren(s, m, e.c) && !s.stale[e.c],
  ProbeWorktree: (s, m, e) => child(m, e) && s.wtState[e.c] === 'created',
  RemoveWorktree: (s, m, e) => child(m, e) && s.wtState[e.c] === 'created' && s.clean[e.c] === true && s.status[e.c] === 'settled',
  WorktreeFound: guardFound, WorktreeLost: guardFound,
  PiCrash: () => true,
  Reconcile: (s, m, e) => child(m, e) && s.stale[e.c] === true && s.effect[e.c] === 'idle' && noLiveChildren(s, m, e.c),
  Clear: (s, m, e) => child(m, e) && s.status[e.c] === 'settled' && s.effect[e.c] === 'idle' && !s.stale[e.c] && (s.wtState[e.c] === 'none' || s.wtState[e.c] === 'removed') && m.agents.every(x => s.parent[x] !== e.c || s.status[x] === 'absent'),
};
export function referenceReduceSubagentState(s: AbstractSubagentState, e: SubagentEvent, m = SUBAGENT_MODEL): AbstractSubagentState {
  if (!guards[e.type](s, m, e)) throw new SubagentStateError(`subagent-${e.type.toLowerCase()}-not-enabled`, 'transition refused');
  const next = { ...s };
  const set = <K extends Exclude<keyof AbstractSubagentState, 'nextSeq'>>(key: K, c: string, value: AbstractSubagentState[K][string]): void => { next[key] = { ...next[key], [c]: value }; };
  if (e.type === 'PiCrash') {
    for (const a of m.agents) if (a !== m.root && live(s, a)) { set('effect', a, 'idle'); set('stale', a, true); }
    return next;
  }
  const c = e.c;
  switch (e.type) {
    case 'Dispatch':
      set('status', c, 'dispatched'); set('authority', c, {...e.auth}); set('parent', c, e.d); set('depth', c, s.depth[e.d]! + 1);
      set('name', c, e.n); set('seq', c, s.nextSeq); set('gen', c, s.gen[c]! + 1); set('worktree', c, e.w);
      set('wtState', c, e.w === m.noWorktree ? 'none' : 'declared'); set('clean', c, false); set('effect', c, 'idle');
      set('effectGen', c, 0); set('terminal', c, 'none'); set('stale', c, false); next.nextSeq++; break;
    case 'AddWorktree': case 'WorktreeFound': set('wtState', c, 'created'); break;
    case 'Admit': set('status', c, 'running'); set('effect', c, 'live'); set('effectGen', c, s.gen[c]!); break;
    case 'Complete': case 'Fail': case 'Cancel':
      set('status', c, 'settled'); set('effect', c, 'idle'); set('terminal', c, e.type === 'Complete' ? 'completed' : e.type === 'Fail' ? 'failed' : 'cancelled');
      if (e.type === 'Cancel') set('gen', c, s.gen[c]! + 1); break;
    case 'ProbeWorktree': set('clean', c, e.healthy); break;
    case 'RemoveWorktree': set('wtState', c, 'removed'); break;
    case 'WorktreeLost': set('wtState', c, 'none'); set('worktree', c, m.noWorktree); break;
    case 'Reconcile': set('status', c, 'settled'); set('terminal', c, 'lost'); set('stale', c, false); break;
    case 'Clear': {
      const initial = initAbstractSubagentState(m);
      for (const key of Object.keys(initial) as (keyof AbstractSubagentState)[]) if (key !== 'nextSeq') set(key, c, initial[key][c]!);
      break;
    }
  }
  return next;
}
export function enabledEvents(s: AbstractSubagentState, m = SUBAGENT_MODEL): SubagentEvent[] {
  const out: SubagentEvent[] = [{type: 'PiCrash'}];
  const add = (e: SubagentEvent): void => { if (guards[e.type](s, m, e)) out.push(e); };
  for (const c of m.agents) {
    for (const type of SUBAGENT_ACTIONS) {
      if (type === 'PiCrash') continue;
      if (type === 'Dispatch') {
        if (s.status[c] !== 'absent') continue;
        for (const d of m.agents) for (const n of m.names) for (const w of [...m.worktrees, m.noWorktree]) for (const auth of [{spawn:false,grant:false}, {spawn:true,grant:false}, {spawn:true,grant:true}]) add({type, d, c, n, w, auth});
      } else if (type === 'ProbeWorktree') { add({type, c, healthy: false}); add({type, c, healthy: true}); }
      else add({type, c});
    }
  }
  return out;
}
export const SUBAGENT_INVARIANT_NAMES = ['TypeOK', 'RootFixed', 'TreeShape', 'DepthBound', 'AuthorityAttenuation', 'NameUnique', 'WorktreeUnique', 'WorktreeDeclared', 'EffectCurrent', 'EffectIdleOutsideRunning', 'TerminalSound', 'WorktreeRemovalSound', 'CleanSound', 'SeqUnique', 'SeqBound', 'LiveChildRunningParent', 'CancelledNoLiveChild', 'StaleSound'] as const;
export interface SubagentViolation { invariant: string; detail: string }
export function subagentInvariantViolations(s: AbstractSubagentState, m = SUBAGENT_MODEL): SubagentViolation[] {
  const out: SubagentViolation[] = [];
  const check = (ok: boolean, invariant: string, a: string): void => { if (!ok) out.push({invariant, detail: a}); };
  const bounded = (v: unknown, max: number): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
  check(bounded(s.nextSeq, m.maxSeq), 'TypeOK', 'nextSeq');
  for (const key of Object.keys(initAbstractSubagentState(m)) as (keyof AbstractSubagentState)[]) {
    if (key !== 'nextSeq') check(Object.keys(s[key] ?? {}).length === m.agents.length && m.agents.every(a => Object.hasOwn(s[key] ?? {}, a)), 'TypeOK', key);
  }
  for (const a of m.agents) {
    const st = s.status[a]; const p = s.parent[a]!; const auth = s.authority[a];
    check(['absent','dispatched','running','settled'].includes(st!), 'TypeOK', a);
    check(['none','completed','failed','cancelled','lost'].includes(s.terminal[a]!), 'TypeOK', a);
    check(['none','declared','created','removed'].includes(s.wtState[a]!), 'TypeOK', a);
    check(['idle','live'].includes(s.effect[a]!), 'TypeOK', a);
    check(auth !== undefined && typeof auth.spawn === 'boolean' && typeof auth.grant === 'boolean' && Object.keys(auth).length === 2, 'TypeOK', a);
    check(typeof s.clean[a] === 'boolean' && typeof s.stale[a] === 'boolean', 'TypeOK', a);
    check([...m.agents,m.noAgent].includes(p) && [...m.names,m.noName].includes(s.name[a]!) && [...m.worktrees,m.noWorktree].includes(s.worktree[a]!), 'TypeOK', a);
    check(bounded(s.depth[a],m.maxDepth) && bounded(s.seq[a],m.maxSeq) && bounded(s.gen[a],m.maxGen) && bounded(s.effectGen[a],m.maxGen), 'TypeOK', a);
    if (a === m.root) check(st === 'running' && p === m.noAgent && s.depth[a] === 0 && s.name[a] === m.noName && s.worktree[a] === m.noWorktree && s.effect[a] === 'idle' && s.terminal[a] === 'none' && auth?.spawn === true && auth.grant === true, 'RootFixed', a);
    if (present(s,a)) {
      check(s.depth[a]! <= m.maxDepth, 'DepthBound', a);
      if (a !== m.root) {
        check(p !== m.noAgent && present(s,p) && s.depth[a] === s.depth[p]! + 1, 'TreeShape', a);
        check(auth !== undefined && s.authority[p] !== undefined && attenuates(s.authority[p]!,auth), 'AuthorityAttenuation', a);
        check(s.name[a] !== m.noName, 'NameUnique', a);
        check(s.seq[a]! < s.nextSeq, 'SeqBound', a);
        if (live(s,a)) check(s.status[p] === 'running', 'LiveChildRunningParent', a);
      }
      for (const b of m.agents) if (a !== b && present(s,b)) {
        check(s.name[a] !== s.name[b], 'NameUnique', a);
        check(s.worktree[a] === m.noWorktree || s.worktree[a] !== s.worktree[b], 'WorktreeUnique', a);
        if (a !== m.root && b !== m.root) check(s.seq[a] !== s.seq[b], 'SeqUnique', a);
      }
    }
    check((s.wtState[a] === 'none' || s.worktree[a] !== m.noWorktree) && ((a !== m.root && st !== 'absent') || s.worktree[a] === m.noWorktree), 'WorktreeDeclared', a);
    check(s.effect[a] !== 'live' || (st === 'running' && s.effectGen[a] === s.gen[a]), 'EffectCurrent', a);
    check(st === 'running' || s.effect[a] === 'idle', 'EffectIdleOutsideRunning', a);
    check((st === 'settled') === (s.terminal[a] !== 'none'), 'TerminalSound', a);
    check(s.wtState[a] !== 'removed' || st === 'settled', 'WorktreeRemovalSound', a);
    check(!s.clean[a] || s.wtState[a] === 'created' || s.wtState[a] === 'removed', 'CleanSound', a);
    check(s.terminal[a] !== 'cancelled' || m.agents.every(x => s.parent[x] !== a || s.status[x] === 'absent' || s.status[x] === 'settled'), 'CancelledNoLiveChild', a);
    check(!s.stale[a] || (present(s,a) && a !== m.root), 'StaleSound', a);
  }
  return out;
}
export function descendants(s: AbstractSubagentState, m: SubagentModelConfig, a: string): string[] {
  const seen = new Set<string>(); const queue = children(s,m,a);
  while (queue.length) { const c = queue.pop()!; if (seen.has(c)) continue; seen.add(c); queue.push(...children(s,m,c)); }
  return [...seen];
}
export function rowToken(s: AbstractSubagentState, a: string): 'absent' | 'queued' | 'running' | Exclude<Terminal, 'none'> {
  if (s.status[a] === 'absent') return 'absent';
  if (s.status[a] === 'dispatched') return 'queued';
  if (s.status[a] === 'running') return 'running';
  return s.terminal[a] === 'none' || s.terminal[a] === undefined ? 'absent' : s.terminal[a];
}
export function subagentViewInvariantViolations(s: AbstractSubagentState, m = SUBAGENT_MODEL): SubagentViolation[] {
  const out = subagentInvariantViolations(s,m);
  for (const a of m.agents) {
    if (s.terminal[a] === 'cancelled' && descendants(s,m,a).some(c => live(s,c))) out.push({invariant:'CancelCascade',detail:a});
    if (a !== m.root && present(s,a) && rowToken(s,a) === 'absent') out.push({invariant:'PresentationTotal',detail:a});
  }
  return out;
}
export const CoreInv = (s: AbstractSubagentState, m = SUBAGENT_MODEL): boolean => subagentInvariantViolations(s,m).length === 0;
export const ViewInv = (s: AbstractSubagentState, m = SUBAGENT_MODEL): boolean => subagentViewInvariantViolations(s,m).length === 0;
