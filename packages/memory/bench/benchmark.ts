import type{EvidenceReference,KnowledgeScope,MemoryRecord}from'@simbot/contracts';
import{MemoryLedger,retrieveHybrid,type EmbeddingProvider}from'../src/index.ts';

export interface LegacyCorpusRecord{id:string;text:string;sourceMessageIds:string[];sourceEventIndexes:number[];validFromTurn:number;validToTurn:number|null;knowledgeScope:string;status:MemoryRecord['status'];}
export interface BenchmarkCorpus{contract:string;messages:Array<{id:string}>;records:LegacyCorpusRecord[];}
export interface BenchmarkQuestion{queryId:string;category:string;atTurn:number;query:string;relevantMessageIds:string[];supersededRecordIds:string[];}
export interface BenchmarkMetrics{recallAt5:number;mrr:number;ndcgAt10:number;precisionAt5:number;supersededRejectionRate:number;}

function scopeOf(value:string):KnowledgeScope{if(value==='user')return{kind:'user',userId:'user'};if(value.startsWith('entity:'))return{kind:'entity',entityId:value.slice(7)};return{kind:'public'};}
function recordOf(value:LegacyCorpusRecord):MemoryRecord{const evidence:EvidenceReference[]=[...value.sourceMessageIds.map((id)=>({kind:'message' as const,id})),...value.sourceEventIndexes.map((id)=>({kind:'event' as const,id:String(id)}))];return{id:value.id,text:value.text,validFromTurn:value.validFromTurn,validToTurn:value.validToTurn,scope:scopeOf(value.knowledgeScope),evidence,status:value.status};}
function mean(values:number[]){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}
function relevantIds(question:BenchmarkQuestion,corpus:BenchmarkCorpus){const messageIds=new Set(question.relevantMessageIds);return new Set(corpus.records.filter((record)=>record.sourceMessageIds.some((id)=>messageIds.has(id))).map((record)=>record.id));}
function dcg(ids:string[],relevant:Set<string>,limit:number){let score=0;for(let index=0;index<Math.min(limit,ids.length);index+=1)if(relevant.has(ids[index]!))score+=1/Math.log2(index+2);return score;}

export async function runBenchmark(corpus:BenchmarkCorpus,questions:BenchmarkQuestion[],provider:EmbeddingProvider):Promise<BenchmarkMetrics>{
  const ledger=new MemoryLedger();ledger.reset(corpus.records.map(recordOf));
  const entityIds=[...new Set(corpus.records.map((record)=>record.knowledgeScope).filter((scope)=>scope.startsWith('entity:')).map((scope)=>scope.slice(7)))];
  const recall:number[]=[],mrr:number[]=[],ndcg:number[]=[],precision:number[]=[],rejection:number[]=[];
  for(const question of questions){
    const result=await retrieveHybrid(ledger,question.query,question.atTurn,provider,{userId:'user',entityIds},10),ids=result.records.map((record)=>record.id),relevant=relevantIds(question,corpus);
    if(relevant.size){const found=ids.slice(0,5).filter((id)=>relevant.has(id)).length;recall.push(found/relevant.size);const rank=ids.findIndex((id)=>relevant.has(id));mrr.push(rank<0?0:1/(rank+1));const ideal=dcg([...relevant],relevant,10);ndcg.push(ideal?dcg(ids,relevant,10)/ideal:0);precision.push(found/Math.max(1,Math.min(5,ids.length)));}
    if(question.supersededRecordIds.length){const top=new Set(ids.slice(0,10));rejection.push(question.supersededRecordIds.filter((id)=>!top.has(id)).length/question.supersededRecordIds.length);}
  }
  return{recallAt5:mean(recall),mrr:mean(mrr),ndcgAt10:mean(ndcg),precisionAt5:mean(precision),supersededRejectionRate:mean(rejection)};
}
