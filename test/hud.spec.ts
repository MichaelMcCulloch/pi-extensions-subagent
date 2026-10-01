import { describe, expect, it } from 'vitest';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth, type TUI } from '@earendil-works/pi-tui';
import { initAbstractSubagentState, referenceReduceSubagentState, SUBAGENT_MODEL, type AbstractSubagentState } from '../src/formal/model.ts';
import { renderRows } from '../src/engine/projection.ts';
import { SubagentExplorer, SubagentWidget, isSubagentEmpty } from '../src/extension/hud.ts';

function withChild(): AbstractSubagentState {
  return referenceReduceSubagentState(
    initAbstractSubagentState(),
    { type: 'Dispatch', d: 'r', c: 'a1', n: 'n1', w: SUBAGENT_MODEL.noWorktree, auth: { spawn: false, grant: false } },
    SUBAGENT_MODEL,
  );
}

const click = { type: 'click', button: 'left', x: 1, y: 1, screenX: 1, screenY: 1, width: 30, height: 1, shift: false, alt: false, ctrl: false } as const;

describe('subagent hud renderers', () => {
  it('treats a fresh tree as empty and a dispatched child as present', () => {
    expect(isSubagentEmpty(initAbstractSubagentState())).toBe(true);
    expect(isSubagentEmpty(withChild())).toBe(false);
  });

  it('shows dispatch and lifecycle tokens from the model', () => {
    const dispatched = renderRows(withChild()).join('\n');
    expect(dispatched).toContain('n1');
    expect(dispatched).toContain('queued');
    const admitted = referenceReduceSubagentState(withChild(), { type: 'Admit', c: 'a1' }, SUBAGENT_MODEL);
    expect(renderRows(admitted).join('\n')).toContain('running');
  });
});

describe('SubagentWidget', () => {
  it('draws the full-width rule above the body', () => {
    const lines = new SubagentWidget(() => ['one']).render(30);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('─'.repeat(30));
    expect(lines[1]).toContain('one');
    for (const line of lines) expect(visibleWidth(line)).toBe(30);
  });

  it('fits lines and caps with a hint', () => {
    const widget = new SubagentWidget(() => ['one', 'two', 'three', 'four'], 2);
    const lines = widget.render(30);
    // separator + two kept + omission hint
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(visibleWidth(line)).toBe(30);
    expect(lines[3]).toContain('+2 more');
  });

  it('renders nothing when empty', () => {
    expect(new SubagentWidget(() => []).render(30)).toEqual([]);
  });

  it('activates on a left click', () => {
    let clicks = 0;
    const widget = new SubagentWidget(() => ['one'], 12, () => { clicks += 1; });
    expect(widget.handleMouse(click)).toEqual({ handled: true });
    expect(clicks).toBe(1);
  });
});

describe('SubagentExplorer', () => {
  it('draws a titled header rule and the body', () => {
    const tui = { terminal: { rows: 20 }, requestRender: () => {} } as unknown as TUI;
    const theme = { bold: (s: string) => s, fg: (_c: string, s: string) => s } as unknown as Theme;
    const lines = new SubagentExplorer(() => ['one', 'two'], tui, () => theme, () => {}).render(40);
    expect(lines[0]).toContain('Subagents');
    expect(lines[1]).toBe('─'.repeat(40));
    expect(lines.join('\n')).toContain('one');
    expect(lines.at(-1)).toContain('1-');
  });
});
