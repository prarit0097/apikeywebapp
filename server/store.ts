import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Provider={id:string;name:string;adapter:'anthropic'|'openai'|'gemini';baseUrl:string;encryptedKey:string;keySuffix:string;quotaGroup:string;models:string[];priority:number;enabled:boolean;paid:boolean;allowPaid:boolean;tools:boolean;contextLimit:number|null;status:string;testedAt:number|null};
export type Alias={id:string;name:string;targets:{providerId:string;model:string}[];allowCrossModel:boolean};
export type QuotaGroup={id:string;allowance:number|null;period:'daily'|'monthly'|'lifetime';consumed:number;reserved:number;resetAt:number|null;cooldownUntil:number;verified:boolean};
function nextReset(period:string){const d=new Date();return period==='daily'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1):period==='monthly'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1):null;}
export class Store{
 db:DatabaseSync;
 constructor(filename:string){this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS providers(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS aliases(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS gateway_keys(id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,prefix TEXT NOT NULL,created INTEGER NOT NULL,last_used INTEGER,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS quota_groups(id TEXT PRIMARY KEY,allowance INTEGER,period TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL DEFAULT 0,reset_at INTEGER,cooldown INTEGER NOT NULL DEFAULT 0,verified INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,amount INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,created INTEGER NOT NULL,alias TEXT NOT NULL,provider TEXT NOT NULL,key_id TEXT,success INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER,latency INTEGER NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS usage_created ON usage(created DESC);`);}
 close(){this.db.close();}
 get(sql:string,...args:any[]){return this.db.prepare(sql).get(...args) as any;}
 all(sql:string,...args:any[]){return this.db.prepare(sql).all(...args) as any[];}
 run(sql:string,...args:any[]){return this.db.prepare(sql).run(...args);}
 transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 providers():Provider[]{return this.all('SELECT json FROM providers').map(r=>JSON.parse(r.json));}
 provider(id:string):Provider|undefined{const r=this.get('SELECT json FROM providers WHERE id=?',id);return r?JSON.parse(r.json):undefined;}
 saveProvider(p:Provider){this.run('INSERT INTO providers(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',p.id,JSON.stringify(p));}
 aliases():Alias[]{return this.all('SELECT json FROM aliases ORDER BY name').map(r=>JSON.parse(r.json));}
 saveAlias(a:Alias){this.run('INSERT INTO aliases(id,name,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,json=excluded.json',a.id,a.name,JSON.stringify(a));}
 saveGroup(g:{id:string;allowance:number|null;period:string;verified?:boolean}){const existing=this.get('SELECT * FROM quota_groups WHERE id=?',g.id);if(existing){if(existing.period!==g.period)throw new Error('Quota period cannot change for an existing group; create a new group');this.run('UPDATE quota_groups SET allowance=?,verified=? WHERE id=?',g.allowance,g.verified?1:0,g.id);}else this.run('INSERT INTO quota_groups(id,allowance,period,reset_at,verified) VALUES(?,?,?,?,?)',g.id,g.allowance,g.period,nextReset(g.period),g.verified?1:0);}
 resetGroups(){const expired=this.all('SELECT id,period FROM quota_groups WHERE reset_at IS NOT NULL AND reset_at<=?',Date.now());for(const g of expired){this.run('DELETE FROM reservations WHERE group_id=?',g.id);this.run('UPDATE quota_groups SET consumed=0,reserved=0,reset_at=? WHERE id=?',nextReset(g.period),g.id);}}
 groups():QuotaGroup[]{this.resetGroups();return this.all('SELECT * FROM quota_groups ORDER BY id').map(g=>({id:g.id,allowance:g.allowance,period:g.period,consumed:g.consumed,reserved:g.reserved,resetAt:g.reset_at,cooldownUntil:g.cooldown,verified:!!g.verified}));}
 reserve(group:string,amount:number):string|null{return this.transaction(()=>{this.resetGroups();const g=this.get('SELECT * FROM quota_groups WHERE id=?',group);if(!g||g.cooldown>Date.now()||(g.allowance!==null&&g.consumed+g.reserved+amount>g.allowance))return null;const id=randomUUID();this.run('INSERT INTO reservations VALUES(?,?,?,?)',id,group,amount,Date.now());this.run('UPDATE quota_groups SET reserved=reserved+? WHERE id=?',amount,group);return id;});}
 settle(id:string,actual:number|null){if(actual===null)return;this.transaction(()=>{const r=this.get('SELECT * FROM reservations WHERE id=?',id);if(!r)return;this.run('UPDATE quota_groups SET reserved=MAX(0,reserved-?),consumed=consumed+? WHERE id=?',r.amount,Math.max(0,actual),r.group_id);this.run('DELETE FROM reservations WHERE id=?',id);});}
 cooldown(group:string,until:number){this.run('UPDATE quota_groups SET cooldown=MAX(cooldown,?) WHERE id=?',until,group);}
 rateLimit(key:string,max:number,windowMs:number){const now=Date.now();this.run('DELETE FROM rate_limits WHERE expires<=?',now);this.run('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+windowMs);return this.get('SELECT count FROM rate_limits WHERE key=?',key).count<=max;}
 log(event:{id:string;alias:string;provider:string;keyId:string|null;success:boolean;input:number|null;output:number|null;latency:number;error:string|null}){this.run('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?)',event.id,Date.now(),event.alias,event.provider,event.keyId,event.success?1:0,event.input,event.output,event.latency,event.error);this.run('DELETE FROM usage WHERE created<?',Date.now()-90*86400000);}
}
