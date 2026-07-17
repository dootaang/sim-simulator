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
const cardPath=resolve(args[0]??'../../소녀전선/소녀전선_잔불.png');
const modulePath=resolve(args[1]??'../../소녀전선/소녀전선 에셋 모듈.charx');
const started=performance.now(),parsed=parseCard(new Uint8Array(await readFile(cardPath)),cardPath),compiled=compileKnownCard(parsed);
assert(compiled,'실카드가 인증된 소녀전선 구조로 탐지되지 않았습니다.');
const profile=cardToRuntimeProject(parsed,compiled),runtime=new ProjectRuntime(profile.project,20260717);
assert(runtime.registry.hasEvent('gfl/start'));
const registration=runtime.dispatch('gfl/start',{mode:'commander'});
assert.equal(registration.log[0]?.ok,true);
const echelons=runtime.select('gfl/echelons')as Array<Record<string,unknown>>,dolls=runtime.select('gfl/dolls')as Array<Record<string,unknown>>;
assert(dolls.length>0&&echelons.length>0);
const hireRefresh=runtime.dispatch('gfl/hire/refresh'),hire=runtime.select('gfl/hire')as{offers:Array<Record<string,unknown>>;capacity:number};
assert.equal(hireRefresh.log[0]?.ok,true);assert.equal(hire.offers.length,5);assert.equal(hire.capacity,3);
const m4=(compiled.schema.gfl as{dolls:Array<Record<string,unknown>>}).dolls.find(value=>value.name==='M4A1');
assert.equal(m4?.price,7000);
const facilities=runtime.select('gfl/facilities')as Array<Record<string,unknown>>,training=facilities.find(value=>value.id==='base1');
assert.deepEqual(training?.cost,{gold:4000,res:2000});
runtime.state.gold=100_000;(runtime.state.resources as Record<string,unknown>).res=100_000;
const firstUpgrade=runtime.dispatch('gfl/facility/upgrade',{facilityId:'base1'}),secondUpgrade=runtime.dispatch('gfl/facility/upgrade',{facilityId:'base1'});
assert.deepEqual(firstUpgrade.log[0]?.cost,{gold:4000,res:2000});assert.deepEqual(secondUpgrade.log[0]?.cost,{gold:6000,res:3000});
const assignment=runtime.dispatch('gfl/echelon/assign',{echelonId:echelons[0]!.id,slot:0,dollId:dolls[0]!.id});
assert.equal(assignment.log[0]?.ok,true);
const assetStarted=performance.now(),assetIndex=await indexZipAssets(await openAsBlob(modulePath));
assert(assetIndex.entries.length>0);
console.log(JSON.stringify({
  card:{name:parsed.name,format:parsed.format,bytes:parsed.sourceBytes.length,embeddedAssets:parsed.assets.length},
  runtime:compiled.diagnosis.runtime,
  native:{modules:compiled.moduleIds,dolls:(compiled.schema.gfl as{dolls:unknown[]}).dolls.length,missions:(compiled.schema.gfl as{missions:unknown[]}).missions.length,echelons:echelons.length,starter:dolls[0]!.name,hireOffers:hire.offers.length,dormCapacity:hire.capacity,m4ContractPrice:m4?.price,facilityCosts:[firstUpgrade.log[0]?.cost,secondUpgrade.log[0]?.cost]},
  assetModule:{entries:assetIndex.totalEntries,images:assetIndex.entries.length,centralDirectoryBytes:assetIndex.centralDirectoryBytes,indexMs:Math.round(performance.now()-assetStarted)},
  totalMs:Math.round(performance.now()-started)
},null,2));
