import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import { initSubagentState, type SubagentState } from './engine/state.ts';
import { renderRows, renderSubagents } from './engine/projection.ts';
import { SubagentStore, SUBAGENT_STATE_ENTRY } from './extension/store.ts';
import { authorityBySessionId, bindingBySessionId, SubagentRuntime } from './extension/runtime.ts';
import { buildSubagentTool } from './extension/tool.ts';
import { SubagentExplorer, SubagentWidget, isSubagentEmpty } from './extension/hud.ts';

/** The custom-entry type that carries one complete subagent snapshot. */
export { SUBAGENT_STATE_ENTRY };

/** The widget slot above the editor. */
const WIDGET_KEY = 'subagent';

/** Fold the newest persisted snapshot out of a session branch. */
export function latestSnapshot(ctx: ExtensionContext): SubagentState | null {
  let snapshot: SubagentState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) if (entry.type === 'custom' && entry.customType === SUBAGENT_STATE_ENTRY) snapshot = entry.data as SubagentState;
  return snapshot;
}

/** Default export consumed by pi. */
export default function subagentExtension(pi: ExtensionAPI): void {
  let runtime: SubagentRuntime | undefined; let context: ExtensionContext | undefined;
  let widgetTui: TUI | null = null; let widgetInstalled = false;
  let detachPersistence: () => void = () => {};

  const hideWidget = (): void => {
    if (widgetInstalled && context !== undefined && context.mode === 'tui' && context.hasUI) context.ui.setWidget(WIDGET_KEY, undefined);
    widgetInstalled = false;
  };

  const refreshWidget = (): void => {
    const ctx = context;
    if (ctx === undefined || runtime === undefined) return;
    if (ctx.mode !== 'tui' || !ctx.hasUI) return;
    if (isSubagentEmpty(runtime.store.state)) { hideWidget(); return; }
    if (!widgetInstalled) {
      ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
        widgetTui = tui;
        return new SubagentWidget(
          () => (runtime === undefined ? [] : renderRows(runtime.store.state)),
          12,
          () => void openExplorer(context ?? ctx),
          () => context?.ui.theme ?? theme,
        );
      });
      widgetInstalled = true;
    }
    widgetTui?.requestRender();
  };

  const openExplorer = async (ctx: ExtensionContext): Promise<void> => {
    if (runtime === undefined) return;
    const body = (): string[] => renderRows(runtime!.store.state);
    if (ctx.mode !== 'tui' || !ctx.hasUI) { ctx.ui.notify(renderSubagents(runtime.store.state), 'info'); return; }
    await ctx.ui.custom<void>((tui, theme, _keys, done) => new SubagentExplorer(body, tui, () => context?.ui.theme ?? theme, () => done()), { overlay: true, overlayOptions: { width: '70%', maxHeight: '80%' } });
  };

  const setup = async (ctx: ExtensionContext): Promise<void> => {
    const snapshot = latestSnapshot(ctx);
    // The host has already selected the destination branch. Do not append
    // shutdown snapshots from the old tree onto that branch.
    detachPersistence();
    hideWidget();
    await runtime?.shutdown(); context = ctx;
    let attached = true;
    detachPersistence = () => { attached = false; };
    const id = ctx.sessionManager.getSessionId(); const binding = bindingBySessionId.get(id);
    const authority = authorityBySessionId.get(id) ?? {spawn:true,grant:true};
    const store = binding?.store ?? new SubagentStore({append:state => {if (attached) {pi.appendEntry(SUBAGENT_STATE_ENTRY,state); refreshWidget();}}},snapshot ?? initSubagentState());
    runtime = new SubagentRuntime(store,binding?.agent ?? store.config.root,pi,() => context!);
    if (!binding) store.recover();
    pi.setActiveTools(authority.spawn ? [...new Set([...pi.getActiveTools(),'subagent'])] : pi.getActiveTools().filter(t => t !== 'subagent'));
    refreshWidget();
  };

  pi.on('session_start',async (_event,ctx) => setup(ctx));
  pi.on('session_tree',async (_event,ctx) => setup(ctx));
  pi.on('session_shutdown',async () => {await runtime?.shutdown(); hideWidget(); runtime = undefined; context = undefined;});
  pi.registerTool(buildSubagentTool(ctx => {context = ctx; if (!runtime) throw new Error('subagent-session-not-started'); return runtime;}));
  pi.registerCommand('subagent',{description:'Inspect the subagent tree',handler:async (_args,ctx) => {
    if (!runtime) return;
    await openExplorer(ctx);
  }});
}
