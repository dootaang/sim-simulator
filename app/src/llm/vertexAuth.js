'use strict';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const cache = new Map();

async function getVertexAccessToken(saJsonString) {
  let sa;
  try {
    sa = parseServiceAccount(saJsonString);
  } catch (err) {
    throw authError(err && err.message ? err.message : '인증 설정 형식을 확인하세요');
  }

  const cached = cache.get(sa.client_email);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return { accessToken: cached.accessToken, projectId: sa.project_id };
  }

  try {
    const tokenUri = sa.token_uri || TOKEN_URI;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: sa.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    };
    const signingInput = `${base64urlJson(header)}.${base64urlJson(claims)}`;
    const key = await importPrivateKey(sa.private_key);
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      utf8(signingInput)
    );
    const assertion = `${signingInput}.${base64urlBytes(signature)}`;
    const body = new URLSearchParams();
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    body.set('assertion', assertion);

    const response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) throw new Error(`토큰 교환 실패 (${response.status})`);
    const json = await response.json();
    if (!json || typeof json.access_token !== 'string' || !json.access_token) {
      throw new Error('토큰 응답 형식을 확인하세요');
    }
    const expiresIn = Number(json.expires_in || 3600);
    cache.set(sa.client_email, {
      accessToken: json.access_token,
      expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
    });
    return { accessToken: json.access_token, projectId: sa.project_id };
  } catch (err) {
    throw authError(err && err.message ? err.message : '토큰 발급 경로를 확인하세요');
  }
}

function invalidateVertexAccessToken(saJsonString) {
  try {
    const sa = parseServiceAccount(saJsonString);
    cache.delete(sa.client_email);
  } catch (_) {
    // Ignore invalid input here; the next token request will return the user-facing error.
  }
}

function parseServiceAccount(saJsonString) {
  let sa;
  try {
    sa = JSON.parse(String(saJsonString || ''));
  } catch (_) {
    throw new Error('인증 설정 형식을 확인하세요');
  }
  for (const key of ['client_email', 'private_key', 'project_id']) {
    if (!sa || typeof sa[key] !== 'string' || !sa[key].trim()) {
      throw new Error('인증 설정 필수 필드를 확인하세요');
    }
  }
  if (sa.token_uri != null && typeof sa.token_uri !== 'string') {
    throw new Error('인증 설정 필수 필드를 확인하세요');
  }
  return {
    client_email: sa.client_email,
    private_key: sa.private_key,
    project_id: sa.project_id,
    token_uri: sa.token_uri || TOKEN_URI,
  };
}

function authError(reason) {
  const err = new Error(`Vertex 인증 실패: ${sanitizeReason(reason)}`);
  err.simbotSafe = true;
  return err;
}

function sanitizeReason(reason) {
  return String(reason || '인증 설정을 확인하세요')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/-----BEGIN[\s\S]*?-----END [A-Z ]+-----/g, '[redacted]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 160);
}

async function importPrivateKey(pem) {
  const der = pemToDer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function pemToDer(pem) {
  const b64 = String(pem || '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!b64) throw new Error('개인 키 형식을 확인하세요');
  return base64ToBytes(b64).buffer;
}

function base64urlJson(value) {
  return base64urlBytes(utf8(JSON.stringify(value)));
}

function base64urlBytes(value) {
  let binary = '';
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

module.exports = {
  getVertexAccessToken,
  invalidateVertexAccessToken,
  _test: {
    base64urlJson,
    base64urlBytes,
    pemToDer,
  },
};
