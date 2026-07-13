import {describe,expect,it} from 'vitest';
import type {ParsedCard} from '@simbot/card';
import {compileCard,normalizeCompiledSchema} from '../src/index.ts';

const card:ParsedCard={format:'charx',source:'inn.charx',spec:'chara_card_v3',specVersion:'3',name:'용사여관',card:{data:{name:'용사여관',description:'객실 숙박과 체크인 체크아웃을 운영한다.'}},assets:[],containerEntries:[],sourceBytes:new Uint8Array([1]),modules:[]};

describe('compiled schema normalization',()=>{
  it('turns common object maps into canonical arrays and synthesizes the inn bindings',()=>{
    const value=normalizeCompiledSchema({meta:{id:'inn'},resources:{food:{unit:'인분',min:0},drink:{unit:'잔',min:0}},scales:{affinity:{owner:'npc',range:[0,200],default:50}},ladders:{reputation:{axes:['village'],ranks:[]}},entities:{facility:{instances:{lv_tavern:{label:'주점',maxLevel:4},lv_kitchen:{label:'주방',maxLevel:4},lv_room:{label:'객실',maxLevel:4},lv_quarter:{label:'직원 숙소',maxLevel:4}}},room:{instances:{'101':{kind:'single',pricePerNight:30000,capacity:1,requiresRoomLevel:1}}},menuItem:{instances:{egg:{name:'달걀',category:'food',price:5000}}}},events:{hire:{params:{}}},quests:[{id:'q1',name:'의뢰',rewardTier:'E',check:{mode:'rate',rate:80}}],initialState:{resources:{food:20,drink:20},facilities:{lv_tavern:1,lv_kitchen:1,lv_room:1,lv_quarter:1}}},['genre.inn']);
    expect(value.schema.resources).toEqual(expect.arrayContaining([expect.objectContaining({id:'food',label:'식자재'})]));
    expect(value.schema.entities).toEqual(expect.arrayContaining([expect.objectContaining({type:'room'})]));
    expect(value.schema).toMatchObject({staffing:{facility:'quarter'},questBoard:{facility:'tavern',unlockLevel:2},traffic:{capacityFacility:'tavern',kitchenFacility:'kitchen',lodging:{roomFacility:'room'}}});
    expect(value.issues.some(issue=>issue.path==='traffic')).toBe(true);
  });

  it('asks the model to repair a structurally invalid but valid JSON response',async()=>{
    let calls=0;
    const good={meta:{id:'inn'},resources:[],scales:[],ladders:[],entities:[],events:[],initialState:{day:1}};
    const result=await compileCard({parsed:card,provider:{async complete(){calls++;return{text:JSON.stringify(calls===1?{meta:{id:'bad'}}:good),events:[]};}}});
    expect(calls).toBe(2);
    expect(result.attempts[0]?.issues.length).toBeGreaterThan(0);
    expect(result.schema.meta).toEqual({id:'inn'});
  });
});
