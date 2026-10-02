import type { ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import { SubagentStateError } from '../formal/model.ts';
import { renderSubagents } from '../engine/projection.ts';
import type { SubagentRuntime } from './runtime.ts';
export const TOOL_ACTIONS = ['start','stop','resume','clear','steer','queue','dispatch','cancel','wait','status','list','cleanup'] as const;
export const SubagentParams = Type.Object({
  action:StringEnum(TOOL_ACTIONS), name:Type.Optional(Type.String()), task:Type.Optional(Type.String()), brief:Type.Optional(Type.String()),
  message:Type.Optional(Type.String()), worktree:Type.Optional(Type.Boolean()), spawn:Type.Optional(Type.Boolean()), grant:Type.Optional(Type.Boolean()), clear:Type.Optional(Type.Boolean()),
});
export function buildSubagentTool(getRuntime: (ctx: ExtensionContext) => SubagentRuntime): ToolDefinition<typeof SubagentParams> {
  return {
    namespace: { name: "subagents", description: "Attenuated child-agent lifecycles" },
    name:'subagent',label:'Subagent',description:'Control a named background child using your model. start (alias dispatch) launches it; stop (alias cancel) aborts it and its descendants; resume restarts a settled child in place; steer queues mid-run guidance; queue queues follow-up work; clear drains a running child\'s queues or forgets a settled record; wait blocks; cleanup removes a settled clean worktree. Optionally allocate a git worktree; never merges. Authority defaults to no spawning.',
    parameters:SubagentParams,executionMode:'sequential',
    outputSchema:Type.Object({action:Type.String(),result:Type.String(),agents:Type.Array(Type.Object({id:Type.String(),name:Type.String(),generation:Type.Integer(),sequence:Type.Integer(),status:Type.String(),terminal:Type.String(),authority:Type.Object({spawn:Type.Boolean(),grant:Type.Boolean()}),worktreeState:Type.String()}))}),
    async execute(_id, params, signal, _update, ctx) {
      const runtime = getRuntime(ctx); let detail = '';
      if (params.action !== 'list' && params.action !== 'status' && !params.name) throw new SubagentStateError('subagent-missing-name','name is required');
      switch (params.action) {
        case 'dispatch':
        case 'start': {
          const task = params.task ?? params.brief;
          if (!task) throw new SubagentStateError('subagent-missing-task','task or brief is required');
          runtime.dispatch({name:params.name!,task,...(params.worktree === undefined ? {} : {worktree:params.worktree}),...(params.spawn === undefined ? {} : {spawn:params.spawn}),...(params.grant === undefined ? {} : {grant:params.grant})}); break;
        }
        case 'wait': detail = await runtime.wait(params.name!,signal); break;
        case 'cancel':
        case 'stop': await runtime.cancel(params.name!); break;
        case 'resume': {
          const task = params.task ?? params.brief;
          runtime.resume({name:params.name!,...(task === undefined ? {} : {task}),...(params.worktree === undefined ? {} : {worktree:params.worktree}),...(params.spawn === undefined ? {} : {spawn:params.spawn}),...(params.grant === undefined ? {} : {grant:params.grant})}); break;
        }
        case 'steer':
        case 'queue': {
          const message = params.message ?? params.task ?? params.brief;
          if (!message) throw new SubagentStateError('subagent-missing-message',`${params.action} requires message`);
          const counts = params.action === 'steer' ? await runtime.steer(params.name!,message) : await runtime.queue(params.name!,message);
          detail = `${params.action}: ${counts.steering} steering, ${counts.followUp} follow-up pending.`; break;
        }
        case 'clear': {
          const drained = runtime.clear(params.name!);
          if (drained.steering.length || drained.followUp.length) detail = `Cleared ${drained.steering.length} steering and ${drained.followUp.length} follow-up messages.`;
          break;
        }
        case 'cleanup': runtime.cleanup(params.name!,params.clear ?? false); break;
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
