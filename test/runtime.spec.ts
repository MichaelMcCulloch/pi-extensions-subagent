import { expect, it, vi } from 'vitest';
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext, Theme } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import { SubagentRuntime, authorityBySessionId, bindingBySessionId } from '../src/extension/runtime.ts';
import { SubagentStore } from '../src/extension/store.ts';
import { initSubagentState } from '../src/engine/state.ts';
import { renderRows } from '../src/engine/projection.ts';
import { buildSubagentTool } from '../src/extension/tool.ts';
import { SubagentExplorer, SubagentWidget } from '../src/extension/hud.ts';
function fixture(shared?: SubagentStore, agent = 'r') {
  const store = shared ?? new SubagentStore({append:() => {}},initSubagentState());
  let finish!: () => void; const pending = new Promise<void>(resolve => {finish = resolve;});
  const id = crypto.randomUUID(); const ctx = {cwd:process.cwd(),model:{id:'same-parent-model'},sessionManager:{getSessionId:() => 'parent'}} as unknown as ExtensionToolContext;
  const sendMessage = vi.fn(); const pi = {sendMessage,getActiveTools:() => ['read','bash','subagent','board']};
  let listener: (e: unknown) => void = () => {};
  const session = {
    bindExtensions:vi.fn(async () => {expect(authorityBySessionId.has(id)).toBe(true);expect(bindingBySessionId.get(id)?.store).toBe(store);}),
    subscribe:vi.fn((fn: typeof listener) => {listener=fn;return () => {};}),
    prompt:vi.fn(async () => {await pending; listener({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'final report'}],stopReason:'stop'}});}),
    abort:vi.fn(async () => {finish();}),dispose:vi.fn(),extensionRunner:{emit:vi.fn(async () => {})},
  };
  const createAgentSession = vi.fn(async (_options: unknown) => ({session}));
  const loaderOptions: unknown[] = [];
  const applyOverrides = vi.fn();
  const sdk = {
    createMcpExtension: () => 'builtin:mcp', createCodemodeExtension: () => 'builtin:codemode', createToolSearchExtension: () => 'builtin:tool-search',
    getAgentDir:() => '/fake-agent-dir',SettingsManager:{create:() => ({applyOverrides})},SessionManager:{inMemory:() => ({getSessionId:() => id})},ModelRuntime:{create:async () => ({})},
    DefaultResourceLoader:class {constructor(options: unknown){loaderOptions.push(options);}async reload() {}},createAgentSession,
  } as unknown as typeof import('@earendil-works/pi-coding-agent');
  const runtime = new SubagentRuntime(store,agent,pi,() => ctx,async () => sdk);
  return {store,runtime,ctx,pi,finish,session,createAgentSession,loaderOptions,id,applyOverrides};
}
it('dispatch returns before prompting, binds authority out-of-band, keeps ambient tools and uses parent model',async () => {
  const f = fixture(); const id = f.runtime.dispatch({name:'research',task:'investigate'});
  expect(f.store.state.status[id]).toBe('dispatched'); expect(f.session.prompt).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(f.session.prompt).toHaveBeenCalled());
  expect(f.createAgentSession.mock.calls[0]![0]).toMatchObject({model:f.ctx.model});
  expect(f.createAgentSession.mock.calls[0]![0]).not.toHaveProperty('tools');
  expect(f.applyOverrides).toHaveBeenCalledWith({defaultTools:['read','bash','board']});
  expect(f.loaderOptions[0]).toMatchObject({noExtensions:false,additionalExtensionPaths:[expect.stringContaining('/src/index.ts')],extensionFactories:['builtin:mcp','builtin:codemode','builtin:tool-search']});
  f.finish(); expect(await f.runtime.wait('research')).toBe('final report');
  expect(f.store.state.terminal[id]).toBe('completed'); expect(f.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({customType:'subagent/result',content:expect.stringContaining('final report')}),{triggerTurn:true});
  expect(authorityBySessionId.has(f.id)).toBe(false);expect(f.session.dispose).toHaveBeenCalled();
});
it('shutdown aborts and disposes children and suppresses parent turn injection',async () => {
  const f = fixture(); const c = f.runtime.dispatch({name:'worker',task:'work',spawn:true,grant:true});
  await vi.waitFor(() => expect(f.session.prompt).toHaveBeenCalled()); await f.runtime.shutdown();
  expect(f.store.state.terminal[c]).toBe('cancelled'); expect(f.session.extensionRunner.emit).toHaveBeenCalledWith({type:'session_shutdown',reason:'quit'}); expect(f.pi.sendMessage).not.toHaveBeenCalled();
});
it('immediate cancellation fences asynchronous setup and invalid attenuation is refused',async () => {
  const f = fixture(); expect(() => f.runtime.dispatch({name:'bad',task:'bad',grant:true})).toThrow('subagent-authority');
  const c = f.runtime.dispatch({name:'cancelled',task:'work'}); await f.runtime.cancel('cancelled');
  expect(f.store.state.terminal[c]).toBe('cancelled'); expect(f.session.prompt).not.toHaveBeenCalled();
});
it('tool refusals are errors and wait is explicitly blocking',async () => {
  const f = fixture(); const tool = buildSubagentTool(() => f.runtime);
  await expect(tool.execute('id',{action:'dispatch'},undefined,undefined,f.ctx)).rejects.toThrow('subagent-missing-name');
  const dispatched=await tool.execute('id',{action:'dispatch',name:'x',brief:'work'},undefined,undefined,f.ctx);
  expect(dispatched.structuredContent).toMatchObject({action:'dispatch',agents:[expect.objectContaining({name:'x',generation:1,sequence:0,authority:{spawn:false,grant:false}})]});
  await vi.waitFor(() => expect(f.session.prompt).toHaveBeenCalled());
  const abort = new AbortController(); abort.abort(); await expect(f.runtime.wait('x',abort.signal)).rejects.toThrow('subagent-wait-aborted');
  expect(f.store.state.status.a1).toBe('running'); f.finish(); await f.runtime.wait('x');
});
it('widget and overlay project the same state and overlay closes on q',() => {
  const f = fixture();
  f.store.apply({event:{type:'Dispatch',d:'r',c:'a1',n:'child',w:f.store.config.noWorktree,auth:{spawn:false,grant:false}}});
  const body = (): string[] => renderRows(f.store.state);
  const widget = new SubagentWidget(body);
  const close = vi.fn();
  const tui = {terminal:{rows:20},requestRender:() => {}} as unknown as TUI;
  const theme = {bold:(s:string) => s,fg:(_c:string,s:string) => s} as unknown as Theme;
  const overlay = new SubagentExplorer(body,tui,() => theme,close);
  expect(widget.render(80).join('\n')).toContain('child');
  expect(overlay.render(80).join('\n')).toContain('child');
  overlay.handleInput('q'); expect(close).toHaveBeenCalled();
});

it('recursive children share attenuation guards and shut down before their parent settles',async () => {
  const parent = fixture(); const c = parent.runtime.dispatch({name:'child',task:'coordinate',spawn:true});
  await vi.waitFor(() => expect(parent.session.prompt).toHaveBeenCalled());
  const child = fixture(parent.store,c);
  expect(() => child.runtime.dispatch({name:'escalate',task:'bad',spawn:true})).toThrow('subagent-authority');
  const grandchild = child.runtime.dispatch({name:'grandchild',task:'work'});
  await vi.waitFor(() => expect(child.session.prompt).toHaveBeenCalled());
  parent.session.extensionRunner.emit.mockImplementation(async () => child.runtime.shutdown());
  await parent.runtime.cancel('child');
  expect(parent.store.state.terminal[c]).toBe('cancelled');
  expect(parent.store.state.terminal[grandchild]).toBe('cancelled');
  parent.runtime.cleanup('grandchild',true); parent.runtime.cleanup('child',true);
  expect(parent.runtime.visibleAgents()).toEqual([]);
});

it('borrows a DAG workspace and report tool without claiming owned-worktree cleanup',async () => {
  const f=fixture(); const reportFactory=() => {};
  expect(() => f.runtime.dispatch({name:'invalid',task:'work',worktree:true},{cwd:'/borrowed'})).toThrow('borrowed');
  const id=f.runtime.dispatch({name:'dag-worker',task:'commit then report'},{cwd:'/borrowed',activeTools:['dag_report'],extensionFactories:[reportFactory]});
  await vi.waitFor(() => expect(f.session.prompt).toHaveBeenCalled());
  expect(f.loaderOptions[0]).toMatchObject({cwd:'/borrowed',extensionFactories:['builtin:mcp','builtin:codemode','builtin:tool-search',reportFactory]});
  expect(f.applyOverrides).toHaveBeenCalledWith({defaultTools:['read','bash','board','dag_report']});
  expect(f.store.state.worktree[id]).toBe(f.store.config.noWorktree);
  f.finish(); await f.runtime.wait('dag-worker');
});
