/** Generate TLC replay data by driving the production store. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { abstractSubagentState, initSubagentState } from '../src/engine/state.ts';
import { enabledEvents, SUBAGENT_ACTIONS, SUBAGENT_MODEL, type AbstractSubagentState, type SubagentEvent } from '../src/formal/model.ts';
import { SubagentStore } from '../src/extension/store.ts';
interface Step { state: AbstractSubagentState; event: SubagentEvent | {type:'Init'} }
const traces: Step[][] = []; const coverage = new Set<string>();
let seed = 1701;
const random = (): number => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 2**32; };
for (let run = 0; run < 256; run++) {
  const store = new SubagentStore({append:() => {}},initSubagentState(SUBAGENT_MODEL),SUBAGENT_MODEL);
  const trace: Step[] = [{state:abstractSubagentState(store.state),event:{type:'Init'}}];
  for (let i = 0; i < 40; i++) {
    const events = enabledEvents(store.state);
    const novel = events.filter(e => !coverage.has(e.type));
    const choices = novel.length ? novel : events;
    const event = choices[Math.floor(random() * choices.length)]!;
    store.apply({event}); coverage.add(event.type);
    trace.push({state:abstractSubagentState(store.state),event});
  }
  traces.push(trace);
}
if (SUBAGENT_ACTIONS.some(a => !coverage.has(a))) throw new Error(`missing actions: ${SUBAGENT_ACTIONS.filter(a => !coverage.has(a))}`);
function tla(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `<<${value.map(tla).join(', ')}>>`;
  if (typeof value === 'object' && value !== null) return `[${Object.entries(value).map(([k,v]) => `${k} |-> ${tla(v)}`).join(', ')}]`;
  throw new Error('unsupported trace value');
}
mkdirSync('spec/generated',{recursive:true});
writeFileSync('spec/generated/TracesData.tla',`---- MODULE TracesData ----\nEXTENDS Naturals\nTraces == ${tla(traces)}\n====\n`);
const distinctAbstractStates = new Set(traces.flat().map(step => JSON.stringify(step.state))).size;
console.log(`trace-summary: traces=${traces.length} actions=${coverage.size} abstractStates=${distinctAbstractStates}`);
