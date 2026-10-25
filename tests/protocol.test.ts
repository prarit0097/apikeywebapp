import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOpenAI, fromOpenAI, openAIEvents, collectMessage, readSSE } from '../server/protocol.js';

test('tool calls and tool results preserve IDs and JSON across formats',()=>{
 const message={model:'coding',max_tokens:100,messages:[{role:'assistant',content:[{type:'tool_use',id:'call_a',name:'read_file',input:{path:'a.ts'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call_a',content:'hello'}]}],tools:[{name:'read_file',input_schema:{type:'object',properties:{path:{type:'string'}}}}]};
 const out=toOpenAI(message,'actual-model');
 assert.equal(out.messages[0].tool_calls[0].id,'call_a');assert.equal(out.messages[1].tool_call_id,'call_a');assert.equal(out.tools[0].function.name,'read_file');
 const back=fromOpenAI({model:'coding',messages:out.messages,tools:out.tools,max_tokens:100});
 assert.equal(back.messages[0].content[0].input.path,'a.ts');assert.equal(back.messages[1].content[0].tool_use_id,'call_a');
});

test('translation explicitly rejects unsupported reasoning or image semantics',()=>{
 assert.throws(()=>toOpenAI({model:'x',messages:[],thinking:{type:'enabled',budget_tokens:1000}},'x'),/support/i);
 assert.throws(()=>toOpenAI({model:'x',messages:[{role:'user',content:[{type:'image',source:{type:'url',url:'https://example.com/image.png'}}]}]},'x'),/support/i);
});

async function* chunks(items:any[]){for(const item of items)yield {data:JSON.stringify(item)};}
test('OpenAI streaming converts text, split tool arguments, stop reason and actual usage',async()=>{
 const events=openAIEvents(chunks([
  {id:'chat1',choices:[{delta:{content:'Hello '}}]},
  {choices:[{delta:{tool_calls:[{index:0,id:'call_1',function:{name:'read_file',arguments:'{"path":'}}]}}]},
  {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"a.ts"}'}}]},finish_reason:'tool_calls'}]},
  {choices:[],usage:{prompt_tokens:12,completion_tokens:8}}
 ]),'coding');
 const result=await collectMessage(events);
 assert.equal(result.content[0].text,'Hello ');assert.equal(result.content[1].input.path,'a.ts');assert.equal(result.content[1].id,'call_1');assert.equal(result.stop_reason,'tool_use');assert.deepEqual(result.usage,{input_tokens:12,output_tokens:8});
});

test('truncated upstream stream is not presented as a completed answer',async()=>{
 await assert.rejects(collectMessage(openAIEvents(chunks([{choices:[{delta:{content:'partial'}}]}]),'coding')),/incomplete|finish/i);
});

test('SSE parser handles split UTF8, CRLF, comments and multiline data',async()=>{
 const bytes=new TextEncoder().encode(': ping\r\nevent: value\r\ndata: {"value":\r\ndata: "नमस्ते"}\r\n\r\n');
 async function* source(){for(let i=0;i<bytes.length;i+=3)yield bytes.slice(i,i+3);}
 const values=[];for await(const value of readSSE(source()))values.push(value);
 assert.equal(values.length,1);assert.equal(JSON.parse(values[0].data).value,'नमस्ते');
});
