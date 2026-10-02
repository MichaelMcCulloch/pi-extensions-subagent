import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import { SubagentStateError } from '../formal/model.ts';
import { renderSubagents } from '../engine/projection.ts';
import type { SubagentRuntime } from './runtime.ts';
export const TOOL_ACTIONS = ['dispatch','status','list','wait','cancel','cleanup','clear'] as const;
export const SubagentParams = Type.Object({
  action:StringEnum(TOOL_ACTIONS), name:Type.Optional(Type.String()), task:Type.Optional(Type.String()), brief:Type.Optional(Type.String()),
  worktree:Type.Optional(Type.Boolean()), spawn:Type.Optional(Type.Boolean()), grant:Type.Optional(Type.Boolean()), clear:Type.Optional(Type.Boolean()),
});
export function buildSubagentTool(getRuntime: (ctx: ExtensionContext) => SubagentRuntime): ToolDefinition<typeof SubagentParams> {
  return {
    namespace: { name: "subagents", description: "Attenuated child-agent lifecycles" },
    name:'subagent',label:'Subagent',description:'Dispatch a named background child using your model. Optionally allocate a git worktree; never merges. Authority defaults to no spawning. Use wait for blocking, cancel to stop, cleanup for settled clean worktrees, and clear to forget.',
    parameters:SubagentParams,executionMode:'sequential',
    outputSchema:Type.Object({action:Type.String(),result:Type.String(),agents:Type.Array(Type.Object({id:Type.String(),name:Type.String(),generation:Type.Integer(),sequence:Type.Integer(),status:Type.String(),terminal:Type.String(),authority:Type.Object({spawn:Type.Boolean(),grant:Type.Boolean()}),worktreeState:Type.String()}))}),
    async execute(_id, params, signal, _update, ctx) {
      const runtime = getRuntime(ctx); let detail = '';
      if (params.action !== 'list' && params.action !== 'status' && !params.name) throw new SubagentStateError('subagent-missing-name','name is required');
      switch (params.action) {
        case 'dispatch': {
          const task = params.task ?? params.brief;
          if (!task) throw new SubagentStateError('subagent-missing-task','task or brief is required');
          runtime.dispatch({name:params.name!,task,...(params.worktree === undefined ? {} : {worktree:params.worktree}),...(params.spawn === undefined ? {} : {spawn:params.spawn}),...(params.grant === undefined ? {} : {grant:params.grant})}); break;
        }
        case 'wait': detail = await runtime.wait(params.name!,signal); break;
        case 'cancel': await runtime.cancel(params.name!); break;
        case 'cleanup': runtime.cleanup(params.name!,params.clear ?? false); break;
        case 'clear': runtime.store.apply({event:{type:'Clear',c: findNamed(runtime,params.name!)}}); break;
        case 'status':
          if (params.name) detail = runtime.store.state.payload[findNamed(runtime,params.name)]?.result ?? '';
          break;
        case 'list': break;
      }
      const text = [renderSubagents(runtime.store.state),detail].filter(Boolean).join('\n\n');
      const s=runtime.store.state;
      const agents=runtime.visibleAgents().map(id=>({id,name:s.name[id],generation:s.gen[id],sequence:s.seq[id],status:s.status[id],terminal:s.terminal[id],authority:s.authority[id],worktreeState:s.wtState[id]}));
      return {content:[{type:'text',text}],details:{action:params.action},structuredContent:JSON.parse(JSON.stringify({action:params.action,result:detail,agents}))};
    },
  };
}
function findNamed(runtime: SubagentRuntime, name: string): string {
  const s = runtime.store.state; const id = runtime.visibleAgents().find(a => s.name[a] === name && s.status[a] !== 'absent');
  if (!id) throw new SubagentStateError('subagent-not-found',name); return id;
}
