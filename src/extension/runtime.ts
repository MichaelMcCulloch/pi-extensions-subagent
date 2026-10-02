import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import type { AgentSession, ExtensionAPI, ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { attenuates, descendants, guards, live, SubagentStateError, type Authority } from '../formal/model.ts';
import { ensureWorktree, probeRepository, probeWorktree, removeWorktree, sanitize, subagentBranch, worktreeRoot } from '../engine/git.ts';
import { SubagentStore } from './store.ts';
type SDK = typeof import('@earendil-works/pi-coding-agent');
export async function loadHostSdk(): Promise<SDK> {
  let entry: string | undefined;
  try {
    const host = realpathSync(process.argv[1]!);
    entry = createRequire(host).resolve('@earendil-works/pi-coding-agent');
  } catch { /* Non-CLI embedding: use the installed SDK. */ }
  return import(entry ? pathToFileURL(entry).href : '@earendil-works/pi-coding-agent') as Promise<SDK>;
}
interface ChildBinding { store: SubagentStore; agent: string }
interface Registry { authority: Map<string, Authority>; binding: Map<string, ChildBinding> }
const symbol = Symbol.for('pi-subagent-lifecycle.registry.v1');
const globalRegistry = globalThis as typeof globalThis & { [symbol]?: Registry };
const registry = globalRegistry[symbol] ??= {authority:new Map(),binding:new Map()};
export const authorityBySessionId = registry.authority;
export const bindingBySessionId = registry.binding;
export interface BorrowedWorkspace { cwd: string; extensionFactories?: ExtensionFactory[]; activeTools?: string[] }
interface Child { done: Promise<void>; session?: AgentSession; cancelled: boolean; gen: number; borrowed?: BorrowedWorkspace }
export interface DispatchInput { name: string; task: string; worktree?: boolean; spawn?: boolean; grant?: boolean }
export class SubagentRuntime {
  private children = new Map<string, Child>();
  private closed = false;
  constructor(public readonly store: SubagentStore, public readonly agent: string, private readonly pi: Pick<ExtensionAPI,'sendMessage'|'getActiveTools'>, private readonly context: () => ExtensionContext, private readonly sdk: () => Promise<SDK> = loadHostSdk, private readonly extensionPath = resolve(dirname(fileURLToPath(import.meta.url)),'../index.ts')) {}
  private own(name: string, includeDescendants = false): string {
    const s = this.store.state;
    const scope = includeDescendants ? descendants(s,this.store.config,this.agent) : Object.keys(s.status).filter(a => s.parent[a] === this.agent);
    const c = scope.find(a => s.name[a] === name && s.status[a] !== 'absent');
    if (!c) throw new SubagentStateError('subagent-not-found',name); return c;
  }
  dispatch(input: DispatchInput, borrowed?: BorrowedWorkspace): string {
    if (this.closed) throw new SubagentStateError('subagent-session-closed','dispatcher stopped');
    if (!input.name.trim() || !input.task.trim()) throw new SubagentStateError('subagent-invalid-dispatch','name and task are required');
    if (borrowed && input.worktree) throw new SubagentStateError('subagent-worktree-ownership','a borrowed worktree cannot also be owned by the child');
    const ctx = this.context();
    if (!ctx.model) throw new SubagentStateError('subagent-no-model','dispatcher has no model');
    const s = this.store.state; const m = this.store.config;
    const c = m.agents.find(a => a !== m.root && s.status[a] === 'absent');
    if (!c) throw new SubagentStateError('subagent-capacity','all 128 slots are occupied');
    const auth = {spawn:input.spawn ?? false,grant:input.grant ?? false};
    if (!s.authority[this.agent]?.spawn || !attenuates(s.authority[this.agent]!,auth)) throw new SubagentStateError('subagent-authority','requested authority cannot be granted');
    const generation = `${ctx.sessionManager.getSessionId()}-${s.nextSeq}`;
    const repo = input.worktree ? probeRepository(ctx.cwd) : null;
    const branch = repo ? subagentBranch(generation,input.name) : null;
    const path = repo ? resolve(worktreeRoot(repo.repo),sanitize(generation),sanitize(input.name)) : null;
    this.store.apply({event:{type:'Dispatch',d:this.agent,c,n:input.name,w:path ?? m.noWorktree,auth},payload:{task:input.task,path,branch,head:repo?.head ?? null}});
    const child: Child = {done:Promise.resolve(),cancelled:false,gen:this.store.state.gen[c]!,...(borrowed ? {borrowed} : {})};
    this.children.set(c,child);
    // Defer all asynchronous setup; dispatch returns the recorded intent immediately.
    child.done = Promise.resolve().then(() => this.run(c,child,ctx,auth,repo));
    // Keep background failures observable through wait without unhandled rejections.
    void child.done.catch(error => console.error('subagent background lifecycle failure', error));
    return c;
  }
  private async run(c: string, child: Child, ctx: ExtensionContext, auth: Authority, repo: ReturnType<typeof probeRepository> | null): Promise<void> {
    let id: string | undefined; let unsubscribe: (() => void) | undefined; let result = ''; let failed = false;
    try {
      const payload = this.store.state.payload[c]!;
      if (child.cancelled) return;
      if (repo && payload.path && payload.branch) {
        ensureWorktree(repo.repo,payload.path,payload.branch,repo.head);
        this.store.apply({event:{type:'AddWorktree',c}});
      }
      const sdk = await this.sdk();
      if (child.cancelled) return;
      const cwd = payload.path ?? child.borrowed?.cwd ?? ctx.cwd; const agentDir = sdk.getAgentDir();
      const settingsManager = sdk.SettingsManager.create(cwd,agentDir);
      settingsManager.applyOverrides({defaultTools:[...new Set([...this.pi.getActiveTools().filter(t => t !== 'subagent' || auth.spawn),...(child.borrowed?.activeTools ?? [])])]});
      const standalone = resolve(dirname(fileURLToPath(import.meta.url)),'../index.ts');
      const resourceLoader = new sdk.DefaultResourceLoader({cwd,agentDir,settingsManager,noExtensions:this.extensionPath !== standalone,additionalExtensionPaths:[this.extensionPath],extensionFactories:[sdk.createMcpExtension(),sdk.createCodemodeExtension({mode:'on'}),sdk.createToolSearchExtension(),...(child.borrowed?.extensionFactories ?? [])]});
      await resourceLoader.reload();
      const sessionManager = sdk.SessionManager.inMemory(cwd);
      id = sessionManager.getSessionId();
      authorityBySessionId.set(id,auth); bindingBySessionId.set(id,{store:this.store,agent:c});
      const modelRuntime = await sdk.ModelRuntime.create({authPath:resolve(agentDir,'auth.json'),modelsPath:resolve(agentDir,'models.json')});
      if (child.cancelled) return;
      const {session} = await sdk.createAgentSession({cwd,agentDir,modelRuntime,model:ctx.model!,resourceLoader,sessionManager,settingsManager,...(ctx.thinkingLevel ? {thinkingLevel:ctx.thinkingLevel} : {})});
      child.session = session;
      await session.bindExtensions({});
      if (child.cancelled) return;
      this.store.apply({event:{type:'Admit',c}});
      unsubscribe = session.subscribe(event => {
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          result = event.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
          failed = event.message.stopReason === 'error' || event.message.stopReason === 'aborted';
        }
      });
      await session.prompt(payload.task,{expandPromptTemplates:false});
    } catch (error) { failed = true; result = String(error); }
    finally {
      unsubscribe?.();
      if (child.session) {
        try { await child.session.abort(); await child.session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}); }
        catch (error) { failed = true; result += `\nShutdown: ${String(error)}`; }
        finally { child.session.dispose(); }
      }
      if (id) { authorityBySessionId.delete(id); bindingBySessionId.delete(id); }
      const s = this.store.state;
      if (s.gen[c] === child.gen && live(s,c)) {
        // Setup failures have no admitted effect; Cancel is the specified transition.
        const type = child.cancelled || s.status[c] === 'dispatched' ? 'Cancel' : failed ? 'Fail' : 'Complete';
        this.store.apply({event:{type,c},payload:{result}});
        if (!this.closed) this.pi.sendMessage({customType:'subagent/result',content:`Subagent ${s.name[c]}: ${this.store.state.terminal[c]}\n${result}`,display:true,details:{agent:c,generation:child.gen}}, {triggerTurn:true});
      }
      this.children.delete(c);
    }
  }
  async wait(name: string, signal?: AbortSignal): Promise<string> {
    const c = this.own(name); const done = this.children.get(c)?.done;
    if (done) {
      if (!signal) await done;
      else await new Promise<void>((resolveWait,reject) => {
        const abort = (): void => reject(new SubagentStateError('subagent-wait-aborted','wait interrupted; child continues'));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort',abort,{once:true});
        void done.then(resolveWait,reject).finally(() => signal.removeEventListener('abort',abort));
      });
    }
    if (live(this.store.state,c)) throw new SubagentStateError('subagent-effect-unavailable','live record has no settled report');
    return this.store.state.payload[c]?.result ?? '';
  }
  async cancel(name: string): Promise<void> {
    const c = this.own(name); const child = this.children.get(c);
    if (child) { child.cancelled = true; await child.session?.abort(); await child.done; }
    else this.store.apply({event:{type:'Cancel',c}});
  }
  cleanup(name: string, clear = false): void {
    const c = this.own(name,true); const s = this.store.state; const p = s.payload[c];
    if (s.status[c] !== 'settled') throw new SubagentStateError('subagent-cleanup-not-enabled','child must be settled');
    if (s.wtState[c] === 'declared' && p?.path) {
      const found = probeWorktree(p.path).exists;
      this.store.apply({event:{type:found ? 'WorktreeFound' : 'WorktreeLost',c}});
    }
    if (this.store.state.wtState[c] === 'created' && p?.path) {
      const probe = probeWorktree(p.path);
      this.store.apply({event:{type:'ProbeWorktree',c,healthy:probe.clean}});
      if (!guards.RemoveWorktree(this.store.state,this.store.config,{type:'RemoveWorktree',c})) throw new SubagentStateError('subagent-cleanup-not-enabled','worktree must be settled and clean');
      removeWorktree(probeRepository(p.path).repo,p.path);
      this.store.apply({event:{type:'RemoveWorktree',c},payload:{head:probe.head}});
    }
    if (clear) this.store.apply({event:{type:'Clear',c}});
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.children].map(async ([,child]) => {child.cancelled = true; await child.session?.abort(); await child.done;}));
  }
  visibleAgents(): string[] { return descendants(this.store.state,this.store.config,this.agent); }
}
