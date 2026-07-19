import{describe,expect,it}from'vitest';import{createMemoryRepository}from'@simbot/persistence';import{defaultCardPreset}from'@simbot/risu';import{ProjectRuntime}from'@simbot/runtime';import{JOURNAL_SHARD_SIZE,MESSAGE_SHARD_SIZE,PlaySession,sessionIntegrity,type SessionSnapshot}from'../src/index.ts';

// 파동 4 — 저장 샤딩: 코어는 얇고, 청크는 꼬리만 다시 쓰고, 조립·검증은 전체를 지킨다.
function runtime(){return new ProjectRuntime({projectId:'shards',schema:{progression:{sources:{train:[2,2]},thresholds:[1_000_000]},initialState:{player:{level:1,exp:0}}},screens:[{id:'play',regions:{actions:[{widget:'action-group',actions:[{event:{id:'progression/gain',params:{source:'train'}}}]}]}}],navigation:[],content:{},featureToggles:{},moduleIds:[]});}
const provider={async complete(){return{text:'ok'};}};
function make(repository:ReturnType<typeof createMemoryRepository<SessionSnapshot>>){return new PlaySession({id:'shards',runtime:runtime(),preset:defaultCardPreset(),card:{name:'S'},repository,provider});}

describe('저장 샤딩',()=>{
  it('코어는 빈 배열+매니페스트, 청크 왕복이 원본과 동일하며 완결 청크는 재기록하지 않는다',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>(),session=make(repository),clicks=MESSAGE_SHARD_SIZE+40;
    for(let i=0;i<clicks;i+=1)await session.runLedgerAction('progression/gain',{source:'train'});
    const core=(await repository.get('shards'))!.payload;
    expect(core.messages).toHaveLength(0);
    if(core.journal?.contract==='simbot-event-journal/0.2')expect(core.journal.events).toHaveLength(0);
    expect(core.shardManifest?.messages.total).toBe(clicks);
    expect(core.shardManifest?.messages.chunks.length).toBe(Math.ceil(clicks/MESSAGE_SHARD_SIZE));
    expect(core.shardManifest?.journalEvents.chunks.length).toBe(Math.ceil(clicks/JOURNAL_SHARD_SIZE));
    // 완결 첫 청크는 이후 저장에서 다시 쓰이지 않는다 — updatedAt이 멈춰 있어야 한다.
    const firstHash=core.shardManifest!.messages.chunks[0]!,first=await repository.get(PlaySession.shardRecordId('shards','messages',0,firstHash)),stamp=first!.updatedAt;
    await new Promise(resolve=>setTimeout(resolve,3));
    await session.runLedgerAction('progression/gain',{source:'train'});
    expect((await repository.get(PlaySession.shardRecordId('shards','messages',0,firstHash)))!.updatedAt).toBe(stamp);
    const restored=make(repository);
    restored.restore(await PlaySession.assembleSnapshot((await repository.get('shards'))!.payload,repository));
    expect(restored.turn).toBe(clicks+1);
    expect(restored.runtime.snapshot()).toEqual(session.runtime.snapshot());
    expect(restored.messages).toEqual(session.messages);
    // 다시 연 장기 회차도 검증된 과거 청크를 재사용한다. 복원 직후 캐시를 잃으면 이 저장이
    // 완결 첫 청크까지 다시 써서 실회차에서만 수초가 걸리는 회귀가 생긴다.
    const restoredCore=(await repository.get('shards'))!.payload,
      restoredFirstHash=restoredCore.shardManifest!.messages.chunks[0]!,
      restoredFirstId=PlaySession.shardRecordId('shards','messages',0,restoredFirstHash),
      restoredStamp=(await repository.get(restoredFirstId))!.updatedAt;
    await new Promise(resolve=>setTimeout(resolve,3));
    await restored.save();
    expect((await repository.get(restoredFirstId))!.updatedAt).toBe(restoredStamp);
  });
  it('청크 누락은 조립 오류, 청크 변조는 integrity가 거부한다',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>(),session=make(repository);
    for(let i=0;i<5;i+=1)await session.runLedgerAction('progression/gain',{source:'train'});
    const core=(await repository.get('shards'))!.payload;
    // 변조: 청크 내용 1필드
    const shardId=PlaySession.shardRecordId('shards','messages',0,core.shardManifest!.messages.chunks[0]),row=(await repository.get(shardId))!;
    ((row.payload as unknown as {items:Array<{content:string}>}).items[0]!).content='조작';
    await repository.put(row);
    await expect(PlaySession.assembleSnapshot((await repository.get('shards'))!.payload,repository)).rejects.toThrow('session_corrupt:shard_hash');
    // 누락: 청크 삭제
    await repository.delete(shardId);
    await expect(PlaySession.assembleSnapshot(core,repository)).rejects.toThrow('session_corrupt:shard_missing');
  });
  it('구형 단일 레코드(인라인)는 그대로 로드되고 다음 save에서 샤딩으로 승격되며, undo 잘림이 고아 청크를 남기지 않는다',async()=>{
    const repository=createMemoryRepository<SessionSnapshot>(),session=make(repository);
    for(let i=0;i<MESSAGE_SHARD_SIZE+10;i+=1)await session.runLedgerAction('progression/gain',{source:'train'});
    // 구형 가장: 인라인 스냅샷(v1 서명)을 통 레코드로 저장
    const inline={...structuredClone(session.snapshot()),id:'legacy'} as SessionSnapshot;
    delete (inline as Partial<SessionSnapshot>).integrityVersion;delete (inline as Partial<SessionSnapshot>).integrity;
    inline.integrity=sessionIntegrity(inline);
    await repository.put({id:'legacy',schemaHash:'shards',title:'legacy',updatedAt:Date.now(),payload:inline});
    const upgraded=new PlaySession({id:'legacy',runtime:runtime(),preset:defaultCardPreset(),card:{name:'S'},repository,provider});
    upgraded.restore(await PlaySession.assembleSnapshot((await repository.get('legacy'))!.payload,repository)); // 조립은 무해(매니페스트 없음)
    await upgraded.save();
    const hot=(await repository.get('legacy'))!.payload;
    expect(hot.shardManifest?.messages.chunks.length).toBeGreaterThan(0); // 승격 완료
    expect(hot.messages).toHaveLength(0);
    // undo로 메시지·이벤트가 줄면 다음 save가 초과 청크를 지운다
    const before=hot.shardManifest!.messages.chunks.length;
    while(upgraded.checkpointDepth>0)await upgraded.undoTurn(); // 디스크 undo 깊이(5)만큼 되감기
    await upgraded.save();
    const after=(await repository.get('legacy'))!.payload.shardManifest!;
    if(after.messages.chunks.length<before)
      expect(await repository.get(PlaySession.shardRecordId('legacy','messages',before-1,hot.shardManifest!.messages.chunks[before-1]))).toBeNull();
    const reopened=new PlaySession({id:'legacy',runtime:runtime(),preset:defaultCardPreset(),card:{name:'S'},repository,provider});
    reopened.restore(await PlaySession.assembleSnapshot((await repository.get('legacy'))!.payload,repository));
    expect(reopened.turn).toBe(upgraded.turn);
  });
});
