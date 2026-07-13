import { describe,expect,it } from 'vitest';
import { createMemoryRepository } from '@simbot/persistence';
import { indexZipAssets,parseCard } from '@simbot/card';
import{zipSync}from'fflate';
import{createMemoryAssetModuleStore,createMemoryCardBinaryStore}from'./card-binary-store';
import { alternateForward,CardLibrary,summarizeEngineState,THUMBNAIL_VERSION } from './card-library';

describe('CardLibrary',()=>{
  it('base64 저장 후 같은 카드로 복원한다',async()=>{const repository=createMemoryRepository<unknown>(),library=new CardLibrary(repository),bytes=new TextEncoder().encode(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'테스트 카드',description:'설명'}})),parsed=parseCard(bytes,'test.json');expect(await library.saveCard(parsed,'card:test')).toBe(true);const restored=await library.loadCard('card:test');expect(restored?.name).toBe(parsed.name);expect([...restored!.sourceBytes]).toEqual([...bytes]);});
  it('binds a separate module without changing card bytes and restores it after recreation',async()=>{const repository=createMemoryRepository<unknown>(),cards=createMemoryCardBinaryStore(),modules=createMemoryAssetModuleStore(),library=new CardLibrary(repository,cards,modules),bytes=new TextEncoder().encode(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'테스트 카드'}})),parsed=parseCard(bytes,'test.json');await library.saveCard(parsed,'card:test');const moduleBytes=zipSync({'assets/silvia_smile.webp':Uint8Array.of(1,2,3)}),blob=new Blob([moduleBytes]),index=await indexZipAssets(blob),module=await library.saveAssetModule(blob,index,'sprites.charx');await library.bindAssetModule('card:test',module.id);const restored=new CardLibrary(repository,cards,modules),assets=await restored.moduleAssets('card:test');expect((await restored.boundAssetModules('card:test'))[0]).toMatchObject({id:module.id,assetCount:1});expect(assets[0]).toMatchObject({name:'silvia_smile',bytes:null,moduleId:module.id});expect(await restored.loadModuleAsset(assets[0]!)).toEqual(Uint8Array.of(1,2,3));expect(new Uint8Array(await(await restored.exportAssetModule(module.id))!.blob.arrayBuffer())).toEqual(moduleBytes);expect((await restored.loadCard('card:test'))?.sourceBytes).toEqual(bytes);});
  // 옛 방식으로 구운 썸네일은 여백이 픽셀에 박혀 있어 CSS로 못 고친다. 재생성 여부는 이 도장으로만 판별하므로
  // 도장이 빠지면 오너가 본 좌우 여백이 영원히 남는다.
  it('썸네일에 굽는 방식 버전을 도장 찍어 낡은 썸네일을 다시 구울 수 있게 한다',async()=>{const repository=createMemoryRepository<unknown>(),library=new CardLibrary(repository),bytes=new TextEncoder().encode(JSON.stringify({spec:'chara_card_v3',spec_version:'3.0',data:{name:'테스트 카드'}})),parsed=parseCard(bytes,'test.json');
    await library.saveCard(parsed,'card:test','','data:image/webp;base64,old');
    expect((await library.listCards())[0]).toMatchObject({thumbnail:'data:image/webp;base64,old',thumbVersion:THUMBNAIL_VERSION});
    await library.saveCard(parsed,'card:plain');
    expect((await library.listCards()).find(card=>card.projectId==='card:plain')?.thumbVersion).toBeUndefined(); // 썸네일이 없으면 도장도 없다 → 열 때 굽는다
    await library.saveThumbnail('card:test','data:image/webp;base64,new');
    expect((await library.listCards()).find(card=>card.projectId==='card:test')).toMatchObject({thumbnail:'data:image/webp;base64,new',thumbVersion:THUMBNAIL_VERSION});
  });
});
describe('리스 대안 버튼',()=>{it('중간에서는 다음 대안을 표시한다',()=>expect(alternateForward(0,2)).toEqual({kind:'show',index:1}));it('끝에서는 새 응답을 생성한다',()=>expect(alternateForward(2,2)).toEqual({kind:'reroll'}));});
describe('엔진 상태 요약',()=>{it('없는 골드는 표시하지 않는다',()=>expect(summarizeEngineState({day:3,resources:{food:4}})).toEqual([{label:'일차',value:'3'},{label:'식자재',value:'4'}]));});
