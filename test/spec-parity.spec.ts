import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { guards, SUBAGENT_ACTIONS, SUBAGENT_INVARIANT_NAMES } from '../src/formal/model.ts';
const tla = readFileSync(new URL('../spec/SubagentSystem.tla',import.meta.url),'utf8');
it('matches the TLA action alphabet, named guards, and core invariant definitions',() => {
  const next = tla.slice(tla.indexOf('\nNext =='),tla.indexOf('\nSettleAny =='));
  const actions = [...new Set([...next.matchAll(/\b([A-Z][A-Za-z]+)\(/g)].map(m => m[1]))]; actions.push('PiCrash');
  expect(actions.sort()).toEqual([...SUBAGENT_ACTIONS].sort());
  expect(Object.keys(guards).sort()).toEqual([...SUBAGENT_ACTIONS].sort());
  for (const action of SUBAGENT_ACTIONS) if (action !== 'PiCrash') expect(tla).toContain(`Guard${action}(`);
  const core = tla.slice(tla.indexOf('\nCoreInv =='),tla.indexOf('\nEffectsTerminate =='));
  expect([...core.matchAll(/\/\\ ([A-Z][A-Za-z]+)/g)].map(m => m[1])).toEqual([...SUBAGENT_INVARIANT_NAMES]);
  for (const name of SUBAGENT_INVARIANT_NAMES) expect(tla).toContain(`\n${name} ==`);
});
