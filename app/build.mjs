import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const tempJs = path.join(dist, 'bundle.js');

await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: tempJs,
  legalComments: 'inline',
  logLevel: 'info',
});

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'persistence', 'sqliteWorker.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: path.join(dist, 'sqlite-worker.js'),
  legalComments: 'inline',
  logLevel: 'info',
});

await Promise.all([
  copyFile(path.join(root, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist', 'sqlite3.wasm'), path.join(dist, 'sqlite3.wasm')),
  copyFile(path.join(root, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist', 'sqlite3-opfs-async-proxy.js'), path.join(dist, 'sqlite3-opfs-async-proxy.js')),
]);

const [js, css] = await Promise.all([
  readFile(tempJs, 'utf8'),
  readFile(path.join(root, 'src', 'style.css'), 'utf8'),
]);

// 재발 방지 가드: CSS 주석이 조기에 닫히면(주석 텍스트에 `*/`가 섞이면)
// :root 토큰 블록까지 CSS 코드로 새어 테마 전체가 무너진다(2026-07-09 사고).
// 주석을 제거한 뒤 남은 :root가 있는지 검사해 빌드를 실패시킨다.
{
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const opens = (css.match(/\/\*/g) || []).length;
  const closes = (css.match(/\*\//g) || []).length;
  if (opens !== closes) throw new Error(`CSS 주석 짝 불일치: /* ${opens}개 vs */ ${closes}개 — 주석 텍스트에 '*/'가 섞였는지 확인`);
  if (!/:root\s*{/.test(stripped)) throw new Error('CSS에서 :root 규칙이 주석 밖에서 감지되지 않음 — 주석이 조기 종료되어 :root를 삼켰을 수 있음');
}

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>시뮬봇 카드 플레이그라운드</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8E%B4%3C/text%3E%3C/svg%3E">
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
${js}
  </script>
</body>
</html>
`;

await writeFile(path.join(dist, 'index.html'), html, 'utf8');
await rm(tempJs, { force: true });
console.log('Built dist/index.html');
