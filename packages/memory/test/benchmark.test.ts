import{describe,expect,it}from'vitest';import corpus from'../bench/fixtures/corpus.json';import questions from'../bench/fixtures/questions.json';import{runBenchmark,type BenchmarkCorpus,type BenchmarkQuestion}from'../bench/benchmark.ts';import{createFixedEmbeddingProvider,embedFixed}from'../src/index.ts';

// 현재 결정론 검색의 실측치보다 약간 낮춘 회귀선이다. 검색 계약이 나빠지면 CI에서 바로 드러난다.
export const BENCHMARK_BASELINE={recallAt5:0.55,mrr:0.45,ndcgAt10:0.50,precisionAt5:0.10,supersededRejectionRate:0.98};
describe('기억 벤치마크 안전망',()=>{
  it('복원 픽스처는 300턴 이상·120문항이며 모든 정답 근거가 실제 코퍼스에 있다',()=>{const data=corpus as BenchmarkCorpus,items=questions.questions as BenchmarkQuestion[],messageIds=new Set(data.messages.map((message)=>message.id)),recordIds=new Set(data.records.map((record)=>record.id));expect(data.messages.length).toBeGreaterThanOrEqual(300);expect(items).toHaveLength(120);for(const question of items){for(const id of question.relevantMessageIds)expect(messageIds.has(id),`${question.queryId}:${id}`).toBe(true);for(const id of question.supersededRecordIds)expect(recordIds.has(id),`${question.queryId}:${id}`).toBe(true);}});
  it('고정 해시그램 임베딩은 네트워크 없이 완전히 재현된다',async()=>{const provider=createFixedEmbeddingProvider({dimension:128});expect(embedFixed('실비아의 약속',128)).toEqual(embedFixed('실비아의 약속',128));expect((await provider.embedDocuments(['문장']))[0]).toHaveLength(128);});
  it('축소 정답지의 검색 지표가 고정 기준선 아래로 내려가지 않는다',async()=>{const subset=(questions.questions as BenchmarkQuestion[]).filter((_,index)=>index%4===0),metrics=await runBenchmark(corpus as BenchmarkCorpus,subset,createFixedEmbeddingProvider());for(const[key,value]of Object.entries(BENCHMARK_BASELINE))expect(metrics[key as keyof typeof metrics],key).toBeGreaterThanOrEqual(value);});
});
