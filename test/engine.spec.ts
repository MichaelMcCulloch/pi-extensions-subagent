import { expect, it } from 'vitest';
import { SUBAGENT_MODEL, guards, initAbstractSubagentState, type SubagentEvent } from '../src/formal/model.ts';
import { initSubagentState, abstractSubagentState } from '../src/engine/state.ts';
import { SubagentStore } from '../src/extension/store.ts';
import { renderRows, rowToken, authorityToken } from '../src/engine/projection.ts';
const dispatch = (c = 'a1', d = 'r', n = 'n1', spawn = false): SubagentEvent => ({type:'Dispatch',c,d,n,w:SUBAGENT_MODEL.noWorktree,auth:{spawn,grant:spawn}});
function store() { const snapshots: unknown[] = []; return {snapshots,store:new SubagentStore({append:s => snapshots.push(s)},initSubagentState(SUBAGENT_MODEL),SUBAGENT_MODEL)}; }
it('persists exact model events, isolates snapshots, refuses disabled actions without writes',() => {
  const {store:s,snapshots} = store();
  expect(() => s.apply({event:{type:'Admit',c:'a1'}})).toThrow('subagent-admit-not-enabled'); expect(snapshots).toHaveLength(0);
  s.apply({event:dispatch(),payload:{task:'do work'}}); s.apply({event:{type:'Admit',c:'a1'}});
  const external = s.state; external.status.a1 = 'absent'; expect(s.state.status.a1).toBe('running');
  s.apply({event:{type:'Complete',c:'a1'},payload:{result:'done'}});
  expect(s.state.payload.a1?.result).toBe('done'); expect(snapshots).toHaveLength(3);
  s.apply({event:{type:'Clear',c:'a1'}}); expect(s.state.payload.a1).toBeUndefined();
});
it('recovery invalidates live effects and reconciles descendants before parents',() => {
  const {store:s} = store(); s.apply({event:dispatch('a1','r','n1',true)}); s.apply({event:{type:'Admit',c:'a1'}}); s.apply({event:dispatch('a2','a1','n2')});
  expect(() => s.apply({event:{type:'Cancel',c:'a1'}})).toThrow();
  s.recover(); expect(s.state.terminal).toMatchObject({a1:'lost',a2:'lost'}); expect(s.state.effect).toMatchObject({a1:'idle',a2:'idle'});
});
it('payload is absent from guards and abstract state; malformed snapshots are rejected',() => {
  const s = initSubagentState(SUBAGENT_MODEL); s.payload.a1 = {task:'anything',result:'anything',path:null,branch:null,head:null,createdAt:'',updatedAt:''};
  expect(abstractSubagentState(s)).toEqual(initAbstractSubagentState()); expect(guards.Dispatch(s,SUBAGENT_MODEL,dispatch())).toBe(true);
  s.status.r = 'absent'; expect(() => new SubagentStore({append:() => {}},s,SUBAGENT_MODEL)).toThrow('subagent-invariant-violation');
});
it('projection derives order and glyphs solely from state',() => {
  const {store:s} = store(); s.apply({event:dispatch('a2')}); s.apply({event:dispatch('a1','r','n2')});
  expect(renderRows(s.state).map(x => x.split(' · ')[0])).toEqual(['○ n1','○ n2']);
  s.apply({event:{type:'Cancel',c:'a2'}}); expect(rowToken(s.state,'a2')).toBe('cancelled'); expect(renderRows(s.state)[0]).toContain('× n1');
  expect(authorityToken({spawn:true,grant:false})).toBe('spawn');
});
it('a failed snapshot append leaves the current state unchanged',() => {
  const s = new SubagentStore({append:() => {throw new Error('disk failure');}},initSubagentState(SUBAGENT_MODEL),SUBAGENT_MODEL);
  expect(() => s.apply({event:dispatch()})).toThrow('disk failure'); expect(s.state.status.a1).toBe('absent'); expect(s.state.revision).toBe(0);
});
