export async function readConfirmation(response:Response,onStep:(step:string)=>void){
 if(!response.headers.get('content-type')?.includes('application/x-ndjson')){
  const data=await response.json();if(!response.ok||!data.success)throw new Error(data.error||'Não consegui confirmar a atualização.');return data;
 }
 const reader=response.body?.getReader();if(!reader)throw new Error('A confirmação não foi recebida. Confira o resultado antes de tentar novamente.');
 const decoder=new TextDecoder();let buffer='',ack:Record<string,unknown>|null=null;
 const event=(line:string)=>{if(!line.trim())return;const data=JSON.parse(line);if(data.type==='progress'&&typeof data.data?.step==='string')onStep(data.data.step);if(data.type==='error')throw new Error(data.data?.message||'Não consegui confirmar.');if(data.type==='done'){if(!data.data?.success)throw new Error('Não recebi a confirmação do banco.');ack=data.data;}};
 try{while(!ack){const chunk=await reader.read();buffer+=decoder.decode(chunk.value??new Uint8Array(),{stream:!chunk.done});let at;while((at=buffer.indexOf('\n'))>=0){event(buffer.slice(0,at));buffer=buffer.slice(at+1);}if(chunk.done){if(buffer.trim())event(buffer);break;}}}
 finally{await reader.cancel().catch(()=>{});}
 if(!ack)throw new Error('A conexão terminou sem confirmação. Confira o resultado antes de tentar novamente.');return ack;
}
