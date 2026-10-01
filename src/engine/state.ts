import { initAbstractSubagentState, SUBAGENT_MODEL, type AbstractSubagentState, type SubagentModelConfig } from '../formal/model.ts';
export interface SubagentPayload { task: string; result: string; path: string | null; branch: string | null; head: string | null; createdAt: string; updatedAt: string }
export interface SubagentState extends AbstractSubagentState { payload: Record<string, SubagentPayload>; revision: number }
export const DEFAULT_SUBAGENT_MODEL: SubagentModelConfig = { ...SUBAGENT_MODEL, agents: ['r', ...Array.from({length:128},(_,i) => `a${i+1}`)], names: [], worktrees: [], maxDepth: 16, maxGen: Number.MAX_SAFE_INTEGER, maxSeq: Number.MAX_SAFE_INTEGER };
export function initSubagentState(m = DEFAULT_SUBAGENT_MODEL): SubagentState { return {...initAbstractSubagentState(m), payload: {}, revision: 0}; }
/** Snapshots are validated by the store, never silently repaired. */
export function normalizeSubagentState(s: SubagentState): SubagentState { return structuredClone(s); }
export function abstractSubagentState(s: SubagentState): AbstractSubagentState {
  const {payload: _payload, revision: _revision, ...abstract} = s; return abstract;
}
/** Production Names/Worktrees are arbitrary strings. Materialize the finite used subset for diagnostics. */
export function productionConfig(s: SubagentState, names: string[] = [], worktrees: string[] = []): SubagentModelConfig {
  return {...DEFAULT_SUBAGENT_MODEL, names: [...new Set([...Object.values(s.name).filter(n => n !== DEFAULT_SUBAGENT_MODEL.noName), ...names])], worktrees: [...new Set([...Object.values(s.worktree).filter(w => w !== DEFAULT_SUBAGENT_MODEL.noWorktree), ...worktrees])]};
}
