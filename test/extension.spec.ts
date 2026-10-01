import { expect, it, vi } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import subagentExtension, { latestSnapshot } from '../src/index.ts';
import { authorityBySessionId, bindingBySessionId } from '../src/extension/runtime.ts';
import { SubagentStore } from '../src/extension/store.ts';
import { initSubagentState } from '../src/engine/state.ts';
it('reconstructs branch snapshots and deactivates subagent for an attenuated child',async () => {
  const handlers = new Map<string,(event: unknown,ctx: ExtensionContext) => Promise<void>>(); const setActiveTools = vi.fn();
  const pi = {on:(event: string,fn: (event: unknown,ctx: ExtensionContext) => Promise<void>) => handlers.set(event,fn), registerTool:vi.fn(),registerCommand:vi.fn(),getActiveTools:() => ['read','subagent'],setActiveTools,appendEntry:vi.fn(),sendMessage:vi.fn()} as unknown as ExtensionAPI;
  const store = new SubagentStore({append:() => {}},initSubagentState()); store.apply({event:{type:'Dispatch',d:'r',c:'a1',n:'child',w:store.config.noWorktree,auth:{spawn:false,grant:false}}}); store.apply({event:{type:'Admit',c:'a1'}});
  const ctx = {mode:'rpc',hasUI:false,sessionManager:{getSessionId:() => 'child',getBranch:() => [{type:'custom',customType:'subagent/state',data:store.state}]}} as unknown as ExtensionContext;
  authorityBySessionId.set('child',{spawn:false,grant:false});bindingBySessionId.set('child',{store,agent:'a1'});
  try {
    subagentExtension(pi); expect(latestSnapshot(ctx)?.status.a1).toBe('running');
    await handlers.get('session_start')!({},ctx); expect(setActiveTools).toHaveBeenCalledWith(['read']); expect(store.state.status.a1).toBe('running');
    await handlers.get('session_shutdown')!({},ctx);
  } finally {authorityBySessionId.delete('child');bindingBySessionId.delete('child');}
});
it('branch switching detaches old shutdown persistence before restoring the destination',async () => {
  const handlers = new Map<string,(event: unknown,ctx: ExtensionContext) => Promise<void>>();
  let tool!: ReturnType<typeof import('../src/extension/tool.ts').buildSubagentTool>;
  const appendEntry = vi.fn();
  const pi = {on:(event: string,fn: (event: unknown,ctx: ExtensionContext) => Promise<void>) => handlers.set(event,fn),registerTool:(value: typeof tool) => {tool=value;},registerCommand:vi.fn(),getActiveTools:() => ['read','subagent'],setActiveTools:vi.fn(),appendEntry,sendMessage:vi.fn()} as unknown as ExtensionAPI;
  const ctx = {cwd:process.cwd(),model:{id:'model'},mode:'rpc',hasUI:false,sessionManager:{getSessionId:() => 'root',getBranch:() => []}} as unknown as import('@earendil-works/pi-coding-agent').ExtensionToolContext;
  subagentExtension(pi); await handlers.get('session_start')!({},ctx);
  // Start and switch synchronously before asynchronous child setup can admit.
  const dispatch = tool.execute('d',{action:'dispatch',name:'old',task:'old task'},undefined,undefined,ctx);
  appendEntry.mockClear(); await handlers.get('session_tree')!({},ctx); await dispatch;
  expect(appendEntry).not.toHaveBeenCalled();
  const result = await tool.execute('s',{action:'list'},undefined,undefined,ctx);
  expect(result.content).toEqual([{type:'text',text:'No subagents.'}]); await handlers.get('session_shutdown')!({},ctx);
});
