import {describe,expect,it} from 'vitest';
import type {ParsedCard} from '@simbot/card';
import {compileCard,normalizeCompiledSchema,resolveModules} from '../src/index.ts';

function card(description:string):ParsedCard{return{format:'charx',source:'card.charx',spec:'chara_card_v3',specVersion:'3',name:'테스트 카드',card:{data:{name:'테스트 카드',description}},assets:[],containerEntries:[],sourceBytes:new Uint8Array([1]),modules:[]};}
const neutralSchema={meta:{id:'card'},resources:[],scales:[],ladders:[],entities:[],events:[],initialState:{day:1}};
const provider={async complete(){return{text:JSON.stringify(neutralSchema),events:[]};}};
const diagnosis=(suggestedModules:string[])=>({suggestedModules}) as Parameters<typeof resolveModules>[1];

describe('compiler-owned genre-neutral template pass',()=>{
  it('keeps the legacy inn resolution order and exclusion result',()=>{
    expect(resolveModules('객실 체크인과 헌터 한 명',diagnosis(['rpg.quests','core.inventory']))).toEqual(['genre.inn','core.inventory']);
  });

  it('installs hunter from two signatures and includes its screen presets',async()=>{
    const result=await compileCard({parsed:card('헌터가 게이트에 진입해 활동한다.'),provider});
    expect(result.moduleIds).toEqual(['genre.hunter']);
    expect(result.screens.map(screen=>screen.id)).toEqual(['hunter-hq','hunter-gates','hunter-party']);
    expect(result.navigation.map(item=>item.screenId)).toEqual(['hunter-hq','hunter-gates','hunter-party']);
  });

  it('does not install hunter from one mention on an inn card',()=>{
    expect(resolveModules('객실 체크인과 체크아웃을 운영하며 헌터 손님도 맞는다.',diagnosis([]))).toEqual(['genre.inn']);
  });

  it('passes an unmatched third genre with zero genre modules and no synthesized fields',()=>{
    expect(resolveModules('galactic school conversation',diagnosis([]))).toEqual([]);
    const result=normalizeCompiledSchema({meta:{id:'third-genre'}},[]);
    expect(result).toEqual({schema:{meta:{id:'third-genre'}},issues:[]});
  });
});
