import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { git, ensureWorktree, probeRepository, probeWorktree, removeWorktree, subagentBranch, worktreeRoot } from '../src/engine/git.ts';
it('allocates idempotently, keeps dirty work and branches, rejects escape and symlink paths',() => {
  mkdirSync('spec/generated',{recursive:true}); const repo = mkdtempSync(resolve('spec/generated/git-'));
  try {
    git(repo,['init']); git(repo,['config','user.name','Test']); git(repo,['config','user.email','test@example.invalid']); git(repo,['commit','--allow-empty','-m','base']);
    const head = probeRepository(repo).head; const path = resolve(worktreeRoot(repo),'one'); const branch = subagentBranch(1,'one');
    ensureWorktree(repo,path,branch,head); ensureWorktree(repo,path,branch,head); expect(probeWorktree(path).clean).toBe(true);
    writeFileSync(resolve(path,'work.txt'),'valuable'); expect(() => removeWorktree(repo,path)).toThrow('subagent-worktree-not-clean');
    ensureWorktree(repo,path,branch,head); expect(probeWorktree(path).clean).toBe(false);
    git(path,['add','work.txt']); git(path,['commit','-m','work']); const childHead = git(path,['rev-parse','HEAD']); removeWorktree(repo,path);
    expect(git(repo,['rev-parse',branch])).toBe(childHead); expect(git(repo,['rev-parse','HEAD'])).toBe(head);
    expect(() => removeWorktree(repo,repo)).toThrow('subagent-worktree-outside-root');
    const link = resolve(worktreeRoot(repo),'link'); symlinkSync(repo,link); expect(() => ensureWorktree(repo,resolve(link,'escape'),'bad',head)).toThrow('subagent-worktree-symlink');
  } finally {rmSync(repo,{recursive:true,force:true});}
});
