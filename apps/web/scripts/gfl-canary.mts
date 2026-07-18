import assert from'node:assert/strict';
import{openAsBlob}from'node:fs';
import{readFile}from'node:fs/promises';
import{resolve}from'node:path';
import{indexZipAssets,parseCard}from'@simbot/card';
import{compileKnownCard}from'@simbot/compiler';
import{cardToRuntimeProject}from'@simbot/risu';
import{ProjectRuntime}from'@simbot/runtime';

// pnpm run이 스크립트에 '--' 구분자를 그대로 넘긴다 — 파일 경로로 오인하지 않게 걸러낸다(다른 카나리아와 동일).
const args=process.argv.slice(2).filter(value=>value!=='--');
const cardPath=resolve(args[0]??'../../../소녀전선/업데이트버전/소녀전선_잔불.png');
const modulePaths=(args.length>1?args.slice(1):[
  '../../../소녀전선/업데이트버전/v0.5fix 소녀전선 에셋 모듈 1번.charx',
  '../../../소녀전선/업데이트버전/v0.5fix 소녀전선 에셋 모듈 2번.charx',
  '../../../소녀전선/업데이트버전/v0.5fix 소녀전선 에셋 모듈 3번.charx'
]).map(value=>resolve(value));
const started=performance.now(),parsed=parseCard(new Uint8Array(await readFile(cardPath)),cardPath),compiled=compileKnownCard(parsed);
assert(compiled,'실카드가 인증된 소녀전선 구조로 탐지되지 않았습니다.');
const profile=cardToRuntimeProject(parsed,compiled),runtime=new ProjectRuntime(profile.project,20260717);
const nativeSchema=compiled.schema.gfl as{dolls:Array<Record<string,unknown>>;missions:Array<Record<string,unknown>>;items:Array<Record<string,unknown>>;equipment:Array<Record<string,unknown>>;bosses:Array<Record<string,unknown>>;noRecruit:string[];documents:Array<Record<string,unknown>>;kalinaComparison:{source:number;matched:number;missing:string[];priceMismatches:Array<Record<string,unknown>>};manufacturing:{pools:{equipment:string[];heavy:string[]}};progression:{byStar:Record<string,number>;missionTypes:Array<Record<string,unknown>>;eventGuides:Record<string,string>};encounters:{pool:string[];ban:string[]}};
assert.deepEqual(nativeSchema.progression.byStar,{0:3,1:5,2:7,3:8,4:9,5:10,6:11});
assert.equal(nativeSchema.progression.missionTypes.length,3);assert.equal(Object.keys(nativeSchema.progression.eventGuides).length,5);
assert.equal(nativeSchema.items.filter(item=>typeof item.drop==='number').length,nativeSchema.items.length);
assert(nativeSchema.encounters.pool.length>0);assert(nativeSchema.encounters.pool.every(id=>nativeSchema.dolls.some(doll=>doll.id===id)));
assert.equal(nativeSchema.bosses.length,26);assert.equal(nativeSchema.noRecruit.length,1);assert.equal(nativeSchema.bosses.filter(boss=>!nativeSchema.noRecruit.includes(String(boss.id))).length,25);
assert.equal(nativeSchema.manufacturing.pools.equipment.length,22);assert.equal(nativeSchema.manufacturing.pools.heavy.length,29);
assert.equal(nativeSchema.documents.length,38);assert.equal(nativeSchema.kalinaComparison.source,19);assert.equal(nativeSchema.kalinaComparison.matched,19);assert.equal(nativeSchema.kalinaComparison.missing.length,0);
assert(runtime.registry.hasEvent('gfl/start'));
const registration=runtime.dispatch('gfl/start',{mode:'commander'});
assert.equal(registration.log[0]?.ok,true);
const echelons=runtime.select('gfl/echelons')as Array<Record<string,unknown>>,dolls=runtime.select('gfl/dolls')as Array<Record<string,unknown>>;
assert.equal(dolls.length,0);assert(echelons.length>0);
const theaters=runtime.select('gfl/theaters')as Array<Record<string,unknown>>,missions=runtime.select('gfl/missions')as Array<Record<string,unknown>>;assert.equal(theaters.length,3);for(const theater of theaters)assert(missions.some(mission=>mission.theater===theater.id));
const hireRefresh=runtime.dispatch('gfl/hire/refresh'),hire=runtime.select('gfl/hire')as{offers:Array<Record<string,unknown>>;capacity:number};
assert.equal(hireRefresh.log[0]?.ok,true);assert.equal(hire.offers.length,5);assert.equal(hire.capacity,4);
runtime.state.gold=100_000;const hired=runtime.dispatch('gfl/hire/contract',{dollId:hire.offers[0]!.id});assert.equal(hired.log[0]?.ok,true);const owned=runtime.select('gfl/dolls')as Array<Record<string,unknown>>;assert.equal(owned.length,1);
const m4=(compiled.schema.gfl as{dolls:Array<Record<string,unknown>>}).dolls.find(value=>value.name==='M4A1');
assert.equal(m4?.price,7000);
const facilities=runtime.select('gfl/facilities')as Array<Record<string,unknown>>,training=facilities.find(value=>value.id==='base1');
assert.deepEqual(training?.cost,{gold:4000,res:2000});
(runtime.state.resources as Record<string,unknown>).res=100_000;
const firstUpgrade=runtime.dispatch('gfl/facility/upgrade',{facilityId:'base1'}),secondUpgrade=runtime.dispatch('gfl/facility/upgrade',{facilityId:'base1'});
assert.deepEqual(firstUpgrade.log[0]?.cost,{gold:4000,res:2000});assert.deepEqual(secondUpgrade.log[0]?.cost,{gold:6000,res:3000});
const assignment=runtime.dispatch('gfl/echelon/assign',{echelonId:echelons[0]!.id,slot:0,dollId:owned[0]!.id});
assert.equal(assignment.log[0]?.ok,true);
const assetStarted=performance.now(),assetModules=[];
for(const modulePath of modulePaths){const moduleStarted=performance.now(),assetIndex=await indexZipAssets(await openAsBlob(modulePath));assert(assetIndex.entries.length>0);assetModules.push({path:modulePath,entries:assetIndex.totalEntries,images:assetIndex.entries.length,centralDirectoryBytes:assetIndex.centralDirectoryBytes,indexMs:Math.round(performance.now()-moduleStarted)});}
console.log(JSON.stringify({
  card:{name:parsed.name,format:parsed.format,bytes:parsed.sourceBytes.length,embeddedAssets:parsed.assets.length},
  runtime:compiled.diagnosis.runtime,
  native:{modules:compiled.moduleIds,dolls:nativeSchema.dolls.length,missions:nativeSchema.missions.length,theaters:theaters.map(value=>value.name),echelons:echelons.length,starter:null,hired:owned[0]!.name,hireOffers:hire.offers.length,dormCapacity:hire.capacity,m4ContractPrice:m4?.price,facilityCosts:[firstUpgrade.log[0]?.cost,secondUpgrade.log[0]?.cost],progression:{byStar:nativeSchema.progression.byStar,missionTypes:nativeSchema.progression.missionTypes.length,eventGuides:Object.keys(nativeSchema.progression.eventGuides).length,itemDrops:nativeSchema.items.filter(item=>typeof item.drop==='number').length,encounterPool:nativeSchema.encounters.pool.length,encounterBan:nativeSchema.encounters.ban.length,bosses:nativeSchema.bosses.length,recruitableBosses:nativeSchema.bosses.length-nativeSchema.noRecruit.length,noRecruit:nativeSchema.noRecruit.length,equipmentPool:nativeSchema.manufacturing.pools.equipment.length,heavyEquipmentPool:nativeSchema.manufacturing.pools.heavy.length,documents:nativeSchema.documents.length,kalinaSource:nativeSchema.kalinaComparison.source,kalinaMatched:nativeSchema.kalinaComparison.matched,kalinaMissing:nativeSchema.kalinaComparison.missing.length,kalinaPriceMismatches:nativeSchema.kalinaComparison.priceMismatches.length}},
  assetModules,
  assetModuleTotals:{modules:assetModules.length,entries:assetModules.reduce((sum,module)=>sum+module.entries,0),images:assetModules.reduce((sum,module)=>sum+module.images,0),centralDirectoryBytes:assetModules.reduce((sum,module)=>sum+module.centralDirectoryBytes,0),indexMs:Math.round(performance.now()-assetStarted)},
  totalMs:Math.round(performance.now()-started)
},null,2));
