import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { SubagentStateError } from '../formal/model.ts';
export function git(cwd: string, args: string[]): string {
  try { return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
  catch (error) { throw new SubagentStateError('subagent-git-failed', String((error as {stderr?:unknown}).stderr ?? error)); }
}
export const worktreeRoot = (repo: string): string => resolve(repo,'.worktrees','subagents');
export function sanitize(name: string): string { return name.replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^[-]+/,'_') || 'agent'; }
export const subagentBranch = (generation: string | number, name: string): string => `dsh/subagent/${sanitize(String(generation))}/${sanitize(name)}`;
export function probeRepository(cwd: string): {repo: string; head: string} {
  const common = git(cwd,['rev-parse','--path-format=absolute','--git-common-dir']);
  return {repo: dirname(common), head: git(cwd,['rev-parse','HEAD'])};
}
function inside(repo: string, path: string): void {
  const root = worktreeRoot(repo); const full = resolve(path);
  if (!full.startsWith(root + sep)) throw new SubagentStateError('subagent-worktree-outside-root',path);
  // Reject symlinks anywhere below the repository, including a symlinked root.
  let cursor = full;
  while (cursor !== resolve(repo)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new SubagentStateError('subagent-worktree-symlink',cursor);
    cursor = dirname(cursor);
  }
}
export function probeWorktree(path: string): {exists: boolean; clean: boolean; head: string | null} {
  if (!existsSync(path)) return {exists:false,clean:false,head:null};
  if (realpathSync(path) !== realpathSync(git(path,['rev-parse','--show-toplevel']))) throw new SubagentStateError('subagent-worktree-not-root',path);
  return {exists:true,clean:git(path,['status','--porcelain','--untracked-files=all']) === '',head:git(path,['rev-parse','HEAD'])};
}
export function ensureWorktree(repo: string, path: string, branch: string, base: string): void {
  inside(repo,path);
  if (existsSync(path)) {
    probeWorktree(path);
    if (git(path,['symbolic-ref','--short','HEAD']) !== branch || realpathSync(git(path,['rev-parse','--path-format=absolute','--git-common-dir'])) !== realpathSync(git(repo,['rev-parse','--path-format=absolute','--git-common-dir']))) throw new SubagentStateError('subagent-worktree-conflict',path);
    return;
  }
  mkdirSync(dirname(path),{recursive:true});
  // A retained branch is never reset: cleanup preserves all committed work.
  let exists = false;
  try { git(repo,['show-ref','--verify',`refs/heads/${branch}`]); exists = true; } catch { /* new branch */ }
  git(repo, exists ? ['worktree','add',path,branch] : ['worktree','add','-b',branch,path,base]);
}
export function removeWorktree(repo: string, path: string): void {
  inside(repo,path);
  const probe = probeWorktree(path);
  if (!probe.exists || !probe.clean) throw new SubagentStateError('subagent-worktree-not-clean',path);
  git(repo,['worktree','remove',path]); // No force, no recursive fallback, no merge.
}
