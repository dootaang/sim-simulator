import type { MemoryRecord } from '@simbot/contracts';
import type { PromptRun } from '@simbot/session';

export type MemoryCounts={total:number;approved:number;candidates:number;archived:number};
export type MemoryReceiptItem={id:string;text:string;kind:string;status:MemoryRecord['status'];sourceMessageId:string|null};

export function isPlayerSafeMemory(record:MemoryRecord){
  if(record.scope.kind==='entity')return false;
  const knowledge=record.knowledge;
  if(knowledge?.state==='hidden'||knowledge?.state==='forgotten')return false;
  return !['private','secret','internal'].includes(knowledge?.privacy??'public');
}

export function memoryCounts(records:readonly MemoryRecord[],archivedIds:ReadonlySet<string>=new Set()):MemoryCounts{
  return{
    total:records.filter(record=>record.status!=='rejected').length,
    approved:records.filter(record=>record.status==='approved').length,
    candidates:records.filter(record=>record.status==='candidate').length,
    archived:records.filter(record=>archivedIds.has(record.id)).length
  };
}

export function memoryKindLabel(kind:MemoryRecord['kind']){
  return({
    'engine-fact':'엔진 사실',event:'사건',promise:'약속',secret:'비밀',relation:'관계',episode:'일화',summary:'요약'
  } as Record<string,string>)[kind??'summary']??kind??'기억';
}

export function memoryStatusLabel(status:MemoryRecord['status']){
  return({approved:'확정',candidate:'검토 대기',rejected:'거절됨',superseded:'지난 기억'} as const)[status];
}

export function sourceMessageId(record:MemoryRecord){
  return record.sourceMessageIds?.find(Boolean)??record.evidence.find(item=>item.kind==='message')?.id??null;
}

export function receiptFor(run:PromptRun|null|undefined,records:readonly MemoryRecord[]){
  const byId=new Map(records.map(record=>[record.id,record]));
  const used=(run?.memoryTrace?.included??[]).flatMap(item=>{
    const record=byId.get(item.id);
    return record&&isPlayerSafeMemory(record)?[itemFor(record)]:[];
  });
  const captured=(run?.memoryDecisions??[]).flatMap(decision=>{
    if(decision.reason==='duplicate'||decision.reason==='invalid')return[];
    const record=byId.get(decision.recordId);
    return record&&isPlayerSafeMemory(record)?[itemFor(record)]:[];
  });
  const hiddenUsed=Math.max(0,(run?.memoryTrace?.included.length??0)-used.length);
  return{used,captured,hiddenUsed};
}

function itemFor(record:MemoryRecord):MemoryReceiptItem{
  return{id:record.id,text:record.text,kind:memoryKindLabel(record.kind),status:record.status,sourceMessageId:sourceMessageId(record)};
}
