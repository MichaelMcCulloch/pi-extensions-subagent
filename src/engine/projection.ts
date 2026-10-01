import { SUBAGENT_MODEL, rowToken, type AbstractSubagentState, type Authority } from '../formal/model.ts';
export { rowToken };
export const authorityToken = (a: Authority): string => a.spawn ? (a.grant ? 'spawn+grant' : 'spawn') : 'none';
export const glyphs = {absent:'', queued:'○', running:'●', completed:'✓', failed:'!', cancelled:'×', lost:'?'} as const;
export function orderedAgents(s: AbstractSubagentState, root = SUBAGENT_MODEL.root): string[] { return Object.keys(s.status).filter(a => a !== root && s.status[a] !== 'absent').sort((a,b) => s.seq[a]! - s.seq[b]!); }
export function renderRows(s: AbstractSubagentState): string[] {
  return orderedAgents(s).map(a => `${'  '.repeat(Math.max(0,s.depth[a]! - 1))}${glyphs[rowToken(s,a)]} ${s.name[a]} · ${rowToken(s,a)} · ${authorityToken(s.authority[a]!)}${s.wtState[a] === 'none' ? '' : ` · worktree ${s.wtState[a]}${s.clean[a] ? ' clean' : ''}`}`);
}
export const renderSubagents = (s: AbstractSubagentState): string => renderRows(s).join('\n') || 'No subagents.';
