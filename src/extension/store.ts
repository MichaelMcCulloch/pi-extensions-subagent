import { SubagentStateError, live, type SubagentModelConfig } from '../formal/model.ts';
import { reduceSubagentCommand, type SubagentCommand } from '../engine/reducer.ts';
import { initSubagentState, normalizeSubagentState, productionConfig, type SubagentState } from '../engine/state.ts';
import { verifySubagentState } from '../engine/verify.ts';
export const SUBAGENT_STATE_ENTRY = 'subagent/state';
export interface SubagentPersistence { append(state: SubagentState): void }
export class SubagentStore {
  #state: SubagentState;
  constructor(private readonly persistence: SubagentPersistence, initial = initSubagentState(), private readonly fixture?: SubagentModelConfig) {
    this.#state = normalizeSubagentState(initial); this.assert(this.#state, this.config);
  }
  get state(): SubagentState { return structuredClone(this.#state); }
  get config(): SubagentModelConfig { return this.fixture ?? productionConfig(this.#state); }
  private assert(s: SubagentState, m: SubagentModelConfig): void {
    const violations = verifySubagentState(s,m);
    if (violations.length) throw new SubagentStateError('subagent-invariant-violation', JSON.stringify(violations));
  }
  apply(command: SubagentCommand): ReturnType<typeof reduceSubagentCommand> {
    const e = command.event;
    const m = this.fixture ?? productionConfig(this.#state, e.type === 'Dispatch' ? [e.n] : [], e.type === 'Dispatch' && e.w !== this.config.noWorktree ? [e.w] : []);
    const result = reduceSubagentCommand(this.#state,command,m); this.assert(result.state,m);
    this.persistence.append(structuredClone(result.state)); this.#state = result.state;
    return structuredClone(result);
  }
  recover(): void {
    const m = this.config;
    if (!m.agents.some(a => a !== m.root && (live(this.#state,a) || this.#state.stale[a]))) return;
    this.apply({event:{type:'PiCrash'}});
    for (const c of [...m.agents].sort((a,b) => this.#state.depth[b]! - this.#state.depth[a]!)) if (this.#state.stale[c]) this.apply({event:{type:'Reconcile',c}});
  }
}
