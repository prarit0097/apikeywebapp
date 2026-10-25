import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';

test('shared quota reservations prevent parallel overspend and survive reconciliation',()=>{
 const s=new Store(':memory:');s.saveGroup({id:'shared',allowance:100,period:'daily'});
 const a=s.reserve('shared',70);assert.ok(a);assert.equal(s.reserve('shared',40),null);
 s.settle(a!,30);assert.ok(s.reserve('shared',60));assert.equal(s.reserve('shared',20),null);s.close();
});

test('unknown upstream usage keeps a conservative reservation instead of fabricating actual tokens',()=>{
 const s=new Store(':memory:');s.saveGroup({id:'shared',allowance:100,period:'lifetime'});
 const a=s.reserve('shared',80)!;s.settle(a,null);assert.equal(s.reserve('shared',30),null);assert.equal(s.groups()[0].consumed,0);assert.equal(s.groups()[0].reserved,80);s.close();
});

test('quota group cooldown blocks every credential sharing that group',()=>{
 const s=new Store(':memory:');s.saveGroup({id:'shared',allowance:null,period:'daily'});s.cooldown('shared',Date.now()+60000);assert.equal(s.reserve('shared',10),null);assert.equal(s.groups().length,1);s.close();
});
