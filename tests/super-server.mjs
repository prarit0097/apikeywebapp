// Deterministic local upstream for browser acceptance; never deployed.
import {readFileSync} from 'node:fs';
import {createApp,finishApp} from '../dist/server/app.js';
import {mountGateway} from '../dist/server/gateway.js';
import {Store} from '../dist/server/store.js';
const env=Object.fromEntries(readFileSync('.private/super-browser.env','utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const store=new Store(env.DATABASE_PATH);let calls=0;
const app=createApp({store,origin:'http://localhost:4000',encryptionKey:Buffer.from(env.ENCRYPTION_KEY,'hex'),bootstrapToken:env.BOOTSTRAP_TOKEN,production:false,providerFetch:async(_url,options)=>{
 calls++;if(options.headers.Authorization==='Bearer fixture-key-a'){async function* body(){yield Buffer.from('{"error":{"code":"rate_limit_exceeded"}}');}return{statusCode:429,headers:{'retry-after':'60'},body:body()};}
 async function* body(){for(const chunk of [{choices:[{delta:{content:'SUPER_OK'}}]},{choices:[{delta:{},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5}}])yield Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`);yield Buffer.from('data: [DONE]\n\n');}return{statusCode:200,headers:{},body:body()};
}});mountGateway(app);finishApp(app);const server=app.listen(4000,'127.0.0.1',()=>console.log('Controlled super-key browser server ready on 4000.'));process.on('SIGINT',()=>server.close(()=>{store.close();process.exit(0);}));
