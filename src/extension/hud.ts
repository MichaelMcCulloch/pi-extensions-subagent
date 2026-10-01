import { matchesKey, Key, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import type { AbstractSubagentState } from '../formal/model.ts';
import { renderRows } from '../engine/projection.ts';
export class SubagentWidget implements Component {
  constructor(private readonly state: () => AbstractSubagentState) {}
  invalidate(): void {}
  render(width: number): string[] { return renderRows(this.state()).map(line => truncateToWidth(line,width)); }
}
export class SubagentExplorer extends SubagentWidget {
  constructor(state: () => AbstractSubagentState, private readonly close: () => void) { super(state); }
  handleInput(data: string): void { if (matchesKey(data,Key.escape) || data === 'q') this.close(); }
}
