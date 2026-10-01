import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { enabledEvents, initAbstractSubagentState, referenceReduceSubagentState, subagentViewInvariantViolations, SUBAGENT_MODEL, type AbstractSubagentState } from '../src/formal/model.ts';
const fields = Object.keys(initAbstractSubagentState()).filter(k => k !== 'nextSeq') as Exclude<keyof AbstractSubagentState,'nextSeq'>[];
function key(s: AbstractSubagentState): string {
  return s.nextSeq + '|' + SUBAGENT_MODEL.agents.map(a => fields.map(k => k === 'authority' ? `${+s.authority[a]!.spawn}${+s.authority[a]!.grant}` : s[k][a]).join(',')).join('|');
}
it('exhaustively matches TLC and checks CoreInv and ViewInv in every reachable state', () => {
  const seen = new Set<string>(); const pending = [initAbstractSubagentState()];
  seen.add(key(pending[0]!));
  while (pending.length) {
    const s = pending.pop()!;
    const violations = subagentViewInvariantViolations(s);
    if (violations.length) throw new Error(JSON.stringify({s, violations}));
    for (const e of enabledEvents(s)) {
      const next = referenceReduceSubagentState(s,e); const k = key(next);
      if (!seen.has(k)) { seen.add(k); pending.push(next); }
    }
  }
  expect(seen.size).toBe(JSON.parse(readFileSync(new URL('../spec/.tlc-state-count.json',import.meta.url),'utf8')).distinctStates);
}, 300_000);
