import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { initSubagentState, type SubagentState } from './engine/state.ts';
import { renderSubagents } from './engine/projection.ts';
import { SubagentStore, SUBAGENT_STATE_ENTRY } from './extension/store.ts';
import { authorityBySessionId, bindingBySessionId, SubagentRuntime } from './extension/runtime.ts';
import { buildSubagentTool } from './extension/tool.ts';
import { SubagentExplorer, SubagentWidget } from './extension/hud.ts';
export function latestSnapshot(ctx: ExtensionContext): SubagentState | null {
  let snapshot: SubagentState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) if (entry.type === 'custom' && entry.customType === SUBAGENT_STATE_ENTRY) snapshot = entry.data as SubagentState;
  return snapshot;
}
export default function subagentExtension(pi: ExtensionAPI): void {
  let runtime: SubagentRuntime | undefined; let context: ExtensionContext | undefined;
  let detachPersistence: () => void = () => {};
  const refresh = (): void => {
    if (context?.mode === 'tui' && context.hasUI && runtime) context.ui.setWidget('subagent',() => new SubagentWidget(() => runtime!.store.state));
  };
  const setup = async (ctx: ExtensionContext): Promise<void> => {
    const snapshot = latestSnapshot(ctx);
    // The host has already selected the destination branch. Do not append
    // shutdown snapshots from the old tree onto that branch.
    detachPersistence();
    await runtime?.shutdown(); context = ctx;
    let attached = true;
    detachPersistence = () => { attached = false; };
    const id = ctx.sessionManager.getSessionId(); const binding = bindingBySessionId.get(id);
    const authority = authorityBySessionId.get(id) ?? {spawn:true,grant:true};
    const store = binding?.store ?? new SubagentStore({append:state => {if (attached) {pi.appendEntry(SUBAGENT_STATE_ENTRY,state); refresh();}}},snapshot ?? initSubagentState());
    runtime = new SubagentRuntime(store,binding?.agent ?? store.config.root,pi,() => context!);
    if (!binding) store.recover();
    pi.setActiveTools(authority.spawn ? [...new Set([...pi.getActiveTools(),'subagent'])] : pi.getActiveTools().filter(t => t !== 'subagent'));
    refresh();
  };
  pi.on('session_start',async (_event,ctx) => setup(ctx));
  pi.on('session_tree',async (_event,ctx) => setup(ctx));
  pi.on('session_shutdown',async () => {await runtime?.shutdown(); if (context?.hasUI) context.ui.setWidget('subagent',undefined); runtime = undefined; context = undefined;});
  pi.registerTool(buildSubagentTool(ctx => {context = ctx; if (!runtime) throw new Error('subagent-session-not-started'); return runtime;}));
  pi.registerCommand('subagent',{description:'Inspect the subagent tree',handler:async (_args,ctx) => {
    if (!runtime) return;
    if (ctx.mode !== 'tui' || !ctx.hasUI) {ctx.ui.notify(renderSubagents(runtime.store.state),'info');return;}
    await ctx.ui.custom<void>((_tui,_theme,_keys,done) => new SubagentExplorer(() => runtime!.store.state,() => done()),{overlay:true,overlayOptions:{width:'90%',maxHeight:'90%'}});
  }});
}
