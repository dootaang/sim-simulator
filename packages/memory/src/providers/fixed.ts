import type{EmbeddingProvider}from'../semantic.ts';

const DEFAULT_DIMENSION=256;
function fnv1a(text:string){let hash=2166136261;for(let index=0;index<text.length;index+=1){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619);}return hash>>>0;}
export function embedFixed(text:string,dimension=DEFAULT_DIMENSION):number[]{
  const size=Math.max(16,Math.trunc(dimension)||DEFAULT_DIMENSION),vector=new Array<number>(size).fill(0),normalized=text.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  if(!normalized)return vector;const padded=` ${normalized} `;
  for(let index=0;index<padded.length-2;index+=1){const hash=fnv1a(padded.slice(index,index+3));vector[hash%size]!+=(hash&0x100)?1:-1;}
  const magnitude=Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0));return magnitude?vector.map((value)=>value/magnitude):vector;
}
export function createFixedEmbeddingProvider(options:{dimension?:number}={}):EmbeddingProvider{
  const dimension=Math.max(16,Math.trunc(options.dimension??DEFAULT_DIMENSION)||DEFAULT_DIMENSION);
  return{modelId:`fixed-hashgram-${dimension}`,dimension,embedDocuments:async(texts)=>texts.map((text)=>embedFixed(text,dimension)),embedQueries:async(texts)=>texts.map((text)=>embedFixed(text,dimension))};
}
