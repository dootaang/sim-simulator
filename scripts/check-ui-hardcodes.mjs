// UX-RENEWAL-MASTER §9.4 — 시각 규칙 우회 방지 검사.
// 플레이어·UI 컴포넌트의 직접 HEX 색상 수를 기준 목록(baseline)과 비교한다.
// 신규 우회는 즉시 실패시키고, 파동별 이주로 수가 줄면 --update로 기준을 내린다(올리는 갱신은 금지).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src/player', 'packages/ui/src'];
const BASELINE_PATH = 'scripts/ui-hardcode-baseline.json';
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function svelteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name).replaceAll('\\', '/'));
}

const counts = {};
for (const root of ROOTS) for (const file of svelteFiles(root)) {
  const found = readFileSync(file, 'utf8').match(HEX)?.length ?? 0;
  if (found) counts[file] = found;
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`기준 갱신: ${Object.keys(counts).length}개 파일, 총 ${Object.values(counts).reduce((a, b) => a + b, 0)}회`);
  process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { /* 기준 없음 = 전부 신규 위반 */ }

const offenders = Object.entries(counts).filter(([file, count]) => count > (baseline[file] ?? 0));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const baseTotal = Object.values(baseline).reduce((a, b) => a + b, 0);

if (offenders.length) {
  console.error('직접 HEX 색상이 기준보다 늘었습니다. 디자인 토큰(var(--color-*))을 사용하세요.');
  for (const [file, count] of offenders) console.error(`  ${file}: ${count} (기준 ${baseline[file] ?? 0})`);
  process.exit(1);
}
console.log(`UI 하드코딩 검사 통과 — 현재 ${total}회 / 기준 ${baseTotal}회${total < baseTotal ? ' (감소분은 --update로 기준 반영 가능)' : ''}`);
