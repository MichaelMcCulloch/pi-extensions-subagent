import { subagentViewInvariantViolations, type SubagentModelConfig, type SubagentViolation } from '../formal/model.ts';
import { productionConfig, type SubagentState } from './state.ts';
export function verifySubagentState(s: SubagentState, m: SubagentModelConfig = productionConfig(s)): SubagentViolation[] {
  return subagentViewInvariantViolations(s,m);
}
