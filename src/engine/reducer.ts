import { referenceReduceSubagentState, type SubagentEvent, type SubagentModelConfig } from '../formal/model.ts';
import { abstractSubagentState, type SubagentPayload, type SubagentState } from './state.ts';
export { SubagentStateError } from '../formal/model.ts';
export interface SubagentCommand { event: SubagentEvent; payload?: Partial<SubagentPayload> }
export function reduceSubagentCommand(s: SubagentState, command: SubagentCommand, m: SubagentModelConfig): {state: SubagentState; events: SubagentEvent[]} {
  const {event} = command;
  const state: SubagentState = {...referenceReduceSubagentState(abstractSubagentState(s), event, m), payload: {...s.payload}, revision: s.revision + 1};
  if (event.type !== 'PiCrash') {
    if (event.type === 'Clear') delete state.payload[event.c];
    else {
      const now = new Date().toISOString();
      state.payload[event.c] = {...(s.payload[event.c] ?? {task:'', result:'', path:null, branch:null, head:null, createdAt:now, updatedAt:now}), ...command.payload, updatedAt:now};
    }
  }
  return {state, events:[event]};
}
