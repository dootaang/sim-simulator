'use strict';

const { getVertexAccessToken, invalidateVertexAccessToken } = require('./vertexAuth.js');

const PROVIDERS = {
  mock: { kind: 'mock', base: '', keyRequired: false, defModel: '' },
  gemini: { kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true, defModel: 'gemini-2.5-flash' },
  openai: { kind: 'openai', base: 'https://api.openai.com/v1', keyRequired: true, defModel: 'gpt-4o-mini' },
  anthropic: { kind: 'anthropic', base: 'https://api.anthropic.com', keyRequired: true, defModel: 'claude-sonnet-5' },
  vertex: { kind: 'vertex', base: '', keyRequired: true, defModel: 'gemini-2.5-flash' },
  custom: { kind: 'openai', base: '', keyRequired: true, defModel: '' },
};

const providerDef = (provider) => PROVIDERS[provider] || PROVIDERS.mock;

async function callProvider(cfg, prompt) {
  const def = providerDef(cfg.provider);
  if (def.kind === 'mock') return mockResponse(prompt);
  if (def.keyRequired && !cfg.apiKey) throw new Error('API 키가 설정되지 않았습니다');
  if (def.kind === 'vertex') return callVertex(def, cfg, prompt);
  const req = buildRequest(def, cfg, prompt);
  const bodyText = await requestWithRetry(req, async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return {
      status: response.status,
      bodyText: await response.text(),
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    };
  }, { retryNetwork: false });
  return parseResponse(req.kind, JSON.parse(bodyText), prompt.allowTruncated);
}

async function callVertex(def, cfg, prompt) {
  const auth = await getVertexAccessToken(cfg.apiKey);
  const location = String(cfg.location || 'global').trim() || 'global';
  const host = location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
  const model = cfg.model || def.defModel;
  if (!model) throw new Error('모델명을 입력하세요');
  const req = {
    url: `${host}/v1/projects/${encodeURIComponent(auth.projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
    method: 'POST',
    kind: 'vertex',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify(buildVertexBody(prompt)),
  };
  let refreshed = false;
  const bodyText = await requestWithRetry(req, async (request) => {
    let response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      invalidateVertexAccessToken(cfg.apiKey);
      const fresh = await getVertexAccessToken(cfg.apiKey);
      request.headers.Authorization = `Bearer ${fresh.accessToken}`;
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }
    return {
      status: response.status,
      bodyText: await response.text(),
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    };
  }, { retryNetwork: false });
  return parseVertexResponse(JSON.parse(bodyText), prompt.allowTruncated);
}

function buildVertexBody(prompt) {
  return {
    systemInstruction: { parts: [{ text: String(prompt.system || '') }] },
    contents: (prompt.messages || []).map((message) => ({
      role: message && message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String((message && message.content) || '') }],
    })),
    generationConfig: {
      temperature: prompt.temperature == null ? 0.7 : prompt.temperature,
      maxOutputTokens: prompt.maxTokens || 8192,
    },
  };
}

function buildRequest(def, cfg, prompt) {
  const base = String(cfg.baseUrl || def.base || '').replace(/\/+$/, '');
  if (!base) throw new Error('서버 주소(endpoint)를 설정하세요');
  const model = cfg.model || def.defModel;
  if (!model) throw new Error('모델명을 입력하세요');
  if (def.kind === 'anthropic') {
    return {
      url: base + '/v1/messages',
      method: 'POST',
      kind: 'anthropic',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey || '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: prompt.maxTokens || 1200,
        temperature: prompt.temperature == null ? 0.7 : prompt.temperature,
        system: prompt.system,
        messages: prompt.messages,
      }),
    };
  }
  const body = {
    model,
    messages: [{ role: 'system', content: prompt.system }].concat(prompt.messages),
    temperature: prompt.temperature == null ? 0.7 : prompt.temperature,
  };
  if (cfg.provider === 'openai') body.max_completion_tokens = prompt.maxTokens || 1200;
  else body.max_tokens = prompt.maxTokens || 1200;
  return {
    url: base + '/chat/completions',
    method: 'POST',
    kind: 'openai',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg.apiKey || '') },
    body: JSON.stringify(body),
  };
}

// allowTruncated: 잘림을 에러로 버리지 않고 {text, truncated}로 반환 — 컴파일러의
// 자동 연속(이어서 출력) 스티칭용. 미지정 시 기존 계약(문자열 반환/잘림은 throw) 유지.
function parseResponse(kind, json, allowTruncated) {
  if (kind === 'anthropic') {
    const truncated = !!(json && json.stop_reason === 'max_tokens');
    const out = json && json.content && json.content[0] && json.content[0].text;
    if (truncated && !allowTruncated) throw new Error('응답이 최대 길이에서 잘렸어요');
    if (typeof out !== 'string' || !out.trim()) throw new Error(truncated ? '응답이 최대 길이에서 잘렸어요' : '모델이 빈 응답을 반환했어요');
    return allowTruncated ? { text: out, truncated } : out;
  }
  const choice = json && json.choices && json.choices[0];
  const finish = choice && choice.finish_reason;
  const truncated = finish === 'length';
  if (truncated && !allowTruncated) throw new Error('응답이 최대 길이에서 잘렸어요');
  if (finish === 'content_filter') throw new Error('안전 필터가 응답을 차단했어요');
  const out = choice && choice.message && choice.message.content;
  if (typeof out !== 'string' || !out.trim()) throw new Error(truncated ? '응답이 최대 길이에서 잘렸어요' : '모델이 빈 응답을 반환했어요');
  return allowTruncated ? { text: out, truncated } : out;
}

function parseVertexResponse(json, allowTruncated) {
  const blocked = json && json.promptFeedback && json.promptFeedback.blockReason;
  if (blocked) throw new Error(`안전 필터가 요청을 차단했어요 (${blocked})`);
  const candidate = json && json.candidates && json.candidates[0];
  if (!candidate) throw new Error('모델 응답에 후보가 없어요 — 정책 차단 또는 요청 형식 오류일 수 있어요');
  const truncated = !!(candidate && candidate.finishReason === 'MAX_TOKENS');
  if (truncated && !allowTruncated) throw new Error('응답이 최대 길이에서 잘렸어요');
  if (candidate && candidate.finishReason === 'SAFETY') throw new Error('안전 필터가 응답을 차단했어요');
  const parts = candidate && candidate.content && candidate.content.parts;
  const out = Array.isArray(parts)
    ? parts.map((part) => part && typeof part.text === 'string' ? part.text : '').join('')
    : '';
  if (typeof out !== 'string' || !out.trim()) throw new Error(truncated ? '응답이 최대 길이에서 잘렸어요' : '모델이 빈 응답을 반환했어요');
  return allowTruncated ? { text: out, truncated } : out;
}

async function requestWithRetry(req, doFetch, opts = {}) {
  const retries = opts.retries == null ? 2 : opts.retries;
  const retries429 = opts.retries429 == null ? 4 : opts.retries429;
  let transient = 0;
  let limited = 0;
  for (;;) {
    let result;
    try {
      result = await doFetch(req);
    } catch (err) {
      if (err && err.simbotSafe) throw err;
      throw new Error('네트워크 요청에 실패했습니다. CORS 또는 제공자 설정을 확인하세요.');
    }
    if (result.status >= 200 && result.status < 300) return result.bodyText;
    if (result.status === 429 && limited < retries429) {
      await sleep(Math.min(60000, result.retryAfterMs || [2000, 5000, 12000, 30000][Math.min(limited, 3)]));
      limited += 1;
      continue;
    }
    if (isTransientStatus(result.status) && result.status !== 429 && transient < retries) {
      await sleep(600 * Math.pow(2, transient));
      transient += 1;
      continue;
    }
    throw new Error(errorText(result.status, result.bodyText));
  }
}

function errorText(status, bodyText) {
  let msg = '';
  try {
    const json = JSON.parse(bodyText);
    const value = json && json.error && (json.error.message || json.error);
    if (typeof value === 'string') msg = value;
  } catch (_) {}
  if (!msg) msg = String(bodyText || '').replace(/\s+/g, ' ').trim();
  msg = msg.slice(0, 240);
  const hint = (status === 401 || status === 403) ? 'API 키·권한을 확인하세요'
    : status === 404 ? '모델명 또는 서버 주소를 확인하세요'
    : status === 402 ? '요금제·크레딧을 확인하세요'
    : status === 429 ? '요청 한도 초과입니다. 잠시 후 다시 시도하세요'
    : status >= 500 ? '제공자 서버 오류입니다'
    : status === 400 || status === 422 ? '요청이 거부됐습니다. 모델·설정을 확인하세요'
    : '요청 실패';
  return `${hint} (${status})${msg ? ': ' + msg : ''}`;
}

function isTransientStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockResponse(prompt) {
  await sleep(200);
  const last = prompt.messages[prompt.messages.length - 1];
  const text = String((last && last.content) || '');
  if (text.includes('마감') || text.includes('잠자리에') || text.includes('오늘은 여기까지')) {
    return '손님들의 마지막 주문이 잦아들고, 여관 홀에는 등불만 낮게 흔들립니다. 당신은 장부를 덮고 오늘 영업을 마무리합니다.\n\n```json\n{"events":[{"id":"day_end","params":{}}]}\n```';
  }
  return '실비아가 고기 스튜 한 그릇을 손님 앞에 내려놓습니다. 손님은 뜨거운 김이 오르는 그릇을 받아 들고 만족스럽게 고개를 끄덕입니다.\n\n```json\n{"events":[{"id":"sale","params":{"menuName":"고기 스튜","qty":1}}]}\n```';
}

module.exports = { PROVIDERS, providerDef, callProvider, buildRequest, parseResponse, requestWithRetry, errorText };
