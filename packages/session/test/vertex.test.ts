import { describe,expect,it,vi } from 'vitest';
import { createProvider } from '../src/providers/index.ts';
import { parseServiceAccount,sanitizeVertex } from '../src/providers/vertex.ts';
import type { CompiledPrompt } from '@simbot/risu';

// 회귀: Vertex 서비스 계정 인증은 레거시 앱(커밋 6ad10e3)에 있었으나 모노레포 마이그레이션이 삭제했다.
// 복원분이 ① SA JSON을 그대로 자격증명으로 쓰고 ② 토큰 교환 후 aiplatform으로 호출하며
// ③ 개인키·토큰을 에러로 흘리지 않는지 검증한다. (실제 서명은 WebCrypto가 필요하므로 토큰 경로는 모킹)

const PEM='-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n';
const SA=JSON.stringify({client_email:'bot@proj.iam.gserviceaccount.com',private_key:PEM,project_id:'proj-1'});
const prompt={messages:[{role:'system',content:'규칙'},{role:'user',content:'안녕'}]} as unknown as CompiledPrompt;

describe('vertex 서비스 계정 프로바이더',()=>{
  it('서비스 계정 JSON을 파싱하고 기본 token_uri를 채운다',()=>{
    const sa=parseServiceAccount(SA);
    expect(sa.project_id).toBe('proj-1');
    expect(sa.token_uri).toBe('https://oauth2.googleapis.com/token');
  });

  it('필수 필드가 없으면 인증 오류를 던진다',()=>{
    expect(()=>parseServiceAccount('{}')).toThrow(/vertex_auth/);
    expect(()=>parseServiceAccount('not json')).toThrow(/vertex_auth/);
  });

  it('개인키·액세스 토큰·URL이 에러 메시지로 새지 않는다(보안 척추)',()=>{
    const leak=`실패: ${PEM} ya29.aaaabbbbcccc https://oauth2.googleapis.com/token`;
    const safe=sanitizeVertex(leak);
    expect(safe).not.toContain('BEGIN PRIVATE KEY');
    expect(safe).not.toContain('ya29.aaaabbbbcccc');
    expect(safe).not.toContain('oauth2.googleapis.com');
    expect(safe).toContain('[redacted]');
  });

  it('여러 줄 JSON 자격증명이 키 로테이션에 찢기지 않는다',async()=>{
    // 줄바꿈 분할이 적용되면 SA JSON 조각이 키로 쓰여 parseServiceAccount가 형식 오류를 낸다.
    const multiline=JSON.stringify({client_email:'a@b.iam.gserviceaccount.com',private_key:PEM,project_id:'p'},null,2);
    const fetchImpl=vi.fn(async()=>new Response('{}',{status:500}));
    const provider=createProvider({provider:'vertex',model:'gemini-2.5-flash',apiKey:multiline},fetchImpl as unknown as typeof fetch);
    // JSON이 찢겼다면 파싱 단계에서 '인증 설정 형식/필수 필드' 오류가 난다. 그 오류가 아니면 자격증명이 온전히 전달된 것.
    const error=await provider.complete({prompt,format:'prose'}).catch((e:Error)=>e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/인증 설정/);
  });

  it('토큰을 얻으면 aiplatform generateContent로 호출하고 산문을 그대로 돌려준다',async()=>{
    const calls:string[]=[];
    const fetchImpl=vi.fn(async(url:string|URL)=>{
      const href=String(url);calls.push(href);
      if(href.includes('oauth2'))return new Response(JSON.stringify({access_token:'ya29.token',expires_in:3600}),{status:200});
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'실비아가 웃는다 [ysp_gold::+10]'}]}}]}),{status:200});
    });
    // crypto.subtle.sign은 Node 24 WebCrypto가 제공하지만 더미 PEM은 import에 실패하므로 서명을 스텁한다.
    const subtle=globalThis.crypto.subtle;
    vi.spyOn(subtle,'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(subtle,'sign').mockResolvedValue(new Uint8Array([1,2,3]).buffer);
    const provider=createProvider({provider:'vertex',model:'gemini-2.5-flash',apiKey:SA,location:'us-central1'},fetchImpl as unknown as typeof fetch);
    const result=await provider.complete({prompt,format:'prose'});
    expect(result.text).toContain('[ysp_gold::+10]'); // 산문 모드: 태그가 본문에 그대로 → 번역기가 처리
    expect(calls[0]).toContain('oauth2.googleapis.com/token');
    expect(calls[1]).toContain('us-central1-aiplatform.googleapis.com');
    expect(calls[1]).toContain('/projects/proj-1/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent');
    vi.restoreAllMocks();
  });
});
