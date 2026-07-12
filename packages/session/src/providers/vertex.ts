// Vertex AI (Google Cloud) — 서비스 계정 인증.
// 출처: 우리 레거시 앱 `app/src/llm/vertexAuth.js`·`providers.js`(커밋 6ad10e3, M3b)의 이식.
// 모노레포 마이그레이션(03074d8)이 레거시 앱과 함께 삭제해 회귀했던 것을 새 프로바이더 계층으로 복원한다.
//
// 흐름: 서비스 계정 JSON → RS256 JWT 자가 서명(WebCrypto) → OAuth2 토큰 교환 → aiplatform generateContent.
// 키·PEM·토큰이 에러 메시지로 새지 않도록 sanitize를 반드시 통과시킨다(보안 척추).
import type { ModelProvider } from '../index.ts';
import { jsonText } from './openai.ts';
import { googlePromptParts } from './google.ts';

const TOKEN_URI='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/cloud-platform';
const cache=new Map<string,{accessToken:string;expiresAt:number}>();

export interface VertexOptions{apiKey:string;model:string;location?:string;temperature?:number;maxTokens?:number;fetch?:typeof globalThis.fetch;}
interface ServiceAccount{client_email:string;private_key:string;project_id:string;token_uri:string;}

// 토큰·개인키·URL은 어떤 경로로도 노출하지 않는다(레거시 sanitizeReason 이관).
export function sanitizeVertex(reason:unknown):string{
  return String(reason??'인증 설정을 확인하세요')
    .replace(/ya29\.[A-Za-z0-9._-]+/g,'[redacted]')
    .replace(/-----BEGIN[\s\S]*?-----END [A-Z ]+-----/g,'[redacted]')
    .replace(/https?:\/\/\S+/g,'[url]')
    .slice(0,160);
}
function authError(reason:unknown){return new Error(`vertex_auth:${sanitizeVertex(reason)}`);}

export function parseServiceAccount(value:string):ServiceAccount{
  let raw:Record<string,unknown>;
  try{raw=JSON.parse(String(value??'')) as Record<string,unknown>;}catch{throw authError('인증 설정 형식을 확인하세요');}
  for(const key of ['client_email','private_key','project_id'] as const){
    const item=raw?.[key];
    if(typeof item!=='string'||!item.trim())throw authError('인증 설정 필수 필드를 확인하세요');
  }
  if(raw.token_uri!=null&&typeof raw.token_uri!=='string')throw authError('인증 설정 필수 필드를 확인하세요');
  return{client_email:String(raw.client_email),private_key:String(raw.private_key),project_id:String(raw.project_id),token_uri:typeof raw.token_uri==='string'&&raw.token_uri?raw.token_uri:TOKEN_URI};
}

const utf8=(value:string)=>new TextEncoder().encode(value);
function base64urlBytes(value:ArrayBuffer|Uint8Array):string{const bytes=value instanceof ArrayBuffer?new Uint8Array(value):value;let binary='';for(let i=0;i<bytes.length;i+=1)binary+=String.fromCharCode(bytes[i]!);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
const base64urlJson=(value:unknown)=>base64urlBytes(utf8(JSON.stringify(value)));
function pemToDer(pem:string):ArrayBuffer{const body=String(pem??'').replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s+/g,'');if(!body)throw authError('개인 키 형식을 확인하세요');const binary=atob(body),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);return bytes.buffer;}

export async function getVertexAccessToken(serviceAccountJson:string,fetchImpl?:typeof globalThis.fetch){
  const sa=parseServiceAccount(serviceAccountJson);
  const cached=cache.get(sa.client_email);
  if(cached&&cached.expiresAt>Date.now()+60_000)return{accessToken:cached.accessToken,projectId:sa.project_id};
  const request=fetchImpl??globalThis.fetch;
  try{
    const now=Math.floor(Date.now()/1000);
    const signingInput=`${base64urlJson({alg:'RS256',typ:'JWT'})}.${base64urlJson({iss:sa.client_email,scope:SCOPE,aud:sa.token_uri,iat:now,exp:now+3600})}`;
    const key=await crypto.subtle.importKey('pkcs8',pemToDer(sa.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8(signingInput));
    const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${signingInput}.${base64urlBytes(signature)}`});
    const response=await request(sa.token_uri,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()});
    if(!response.ok)throw new Error(`토큰 교환 실패 (${response.status})`);
    const json=await response.json() as {access_token?:unknown;expires_in?:unknown};
    if(typeof json?.access_token!=='string'||!json.access_token)throw new Error('토큰 응답 형식을 확인하세요');
    const expiresIn=Number(json.expires_in??3600);
    cache.set(sa.client_email,{accessToken:json.access_token,expiresAt:Date.now()+Math.max(0,expiresIn-60)*1000});
    return{accessToken:json.access_token,projectId:sa.project_id};
  }catch(error){throw authError(error instanceof Error?error.message:error);}
}
export function invalidateVertexAccessToken(serviceAccountJson:string){try{cache.delete(parseServiceAccount(serviceAccountJson).client_email);}catch{/* 다음 발급에서 사용자에게 오류를 알린다 */}}

export function createVertexProvider(options:VertexOptions):ModelProvider{
  const request=options.fetch??globalThis.fetch;
  return{async complete({prompt,signal,format='json'}){
    if(!options.model)throw new Error('vertex_model_required');
    const {system,contents}=googlePromptParts(prompt.messages);
    const location=(options.location??'global').trim()||'global';
    const host=location==='global'?'https://aiplatform.googleapis.com':`https://${location}-aiplatform.googleapis.com`;
    const generationConfig:Record<string,unknown>={temperature:options.temperature??.8,...(options.maxTokens?{maxOutputTokens:options.maxTokens}:{})};
    if(format==='json')generationConfig.responseMimeType='application/json';
    const body=JSON.stringify({contents,...(system?{systemInstruction:{parts:[{text:system}]}}:{}),generationConfig});
    const call=async(refresh:boolean)=>{
      if(refresh)invalidateVertexAccessToken(options.apiKey);
      const auth=await getVertexAccessToken(options.apiKey,request);
      const url=`${host}/v1/projects/${encodeURIComponent(auth.projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(options.model)}:generateContent`;
      return request(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth.accessToken}`},body,...(signal?{signal}:{})});
    };
    let response:Response;
    try{response=await call(false);if(response.status===401)response=await call(true);}  // 만료 토큰이면 1회만 갱신 재시도
    catch(error){throw error instanceof Error&&error.message.startsWith('vertex_auth:')?error:new Error(`model_network:${sanitizeVertex(error instanceof Error?error.message:error)}`);}
    if(!response.ok)throw new Error(`model_http_${response.status}:${sanitizeVertex(await response.text().catch(()=>''))}`);
    const json=await response.json() as {promptFeedback?:{blockReason?:string};candidates?:Array<{content?:{parts?:Array<{text?:string}>}}>};
    if(json.promptFeedback?.blockReason)throw new Error(`model_blocked:${sanitizeVertex(json.promptFeedback.blockReason)}`);
    const text=(json.candidates?.[0]?.content?.parts??[]).map(part=>part.text??'').join('');
    if(!text)throw new Error('model_content_missing');
    return format==='prose'?{text,events:[],speakers:[],memories:[]}:jsonText(text);
  }};
}
