// RisuAI `src/ts/process/scripts.ts` (kwaroran/RisuAI, GPL-3.0, commit eb7780b) 전체 이식 — ADR 0004.
// 원본의 processScriptFull 의미론을 보존하되, DB·Svelte 스토어·Lua·트리거·플러그인·dynamicAssets
// 결합부는 RisuScriptEnv 훅으로 치환한다. 훅이 비면 해당 기능은 조용히 건너뛴다(원본이 DB 부재에서
// 그러하듯). Lua(edit trigger)와 display 트리거는 M-C/M-D에서 async 래퍼가 이 코어 앞뒤에 붙는다.
// 원본과의 diff 추적을 위해 함수·분기 구조를 의도적으로 미러링한다 — 여기서 "개선"하지 말 것.

export type ScriptMode = 'editinput' | 'editoutput' | 'editprocess' | 'editdisplay';

export interface PortRegexScript { in?: string; out?: string; type?: string; flag?: string; flags?: string; ableFlag?: boolean }

export interface RisuScriptEnv {
  /** risuChatParser 대응 — 지금은 우리 parseCbs 래퍼, M-B에서 전체 이식으로 교체된다. */
  parser?: (text: string) => string;
  /** @@emo — 원본은 CharEmotion 스토어에 감정 이미지를 쌓는다. 우리는 화자 무대가 소비한다. */
  emotionSink?: (emotionName: string) => void;
  /** @@inject — 원본은 현재 메시지의 data를 정규식 적용 전 원문으로 되돌려 저장한다. */
  injectMessageData?: (data: string) => void;
  /** @@repeat_back — 직전 같은 role 메시지의 원문(없으면 첫 인사)을 돌려준다. */
  previousSameRole?: () => string | null;
  /** 스크립트 하나를 건너뛸지 판단하는 우리 강화 훅(catastrophic 패턴 등). 원본에는 없다. */
  skipScript?: (source: string) => boolean;
  /** 시간 예산 초과 시 남은 스크립트를 중단하는 우리 강화 훅. 원본에는 없다. */
  outOfBudget?: () => boolean;
}

const dreg = /{{data}}/g;

interface PScript { script: { in: string; out: string; type: string; flag: string; ableFlag: boolean }; order: number; actions: string[] }

// 원본 executeScript + 본문 루프의 동기 이식. 반환은 원본과 같이 { data, emoChanged }.
export function processScriptsCore(input: string, rawScripts: readonly PortRegexScript[], mode: ScriptMode, env: RisuScriptEnv = {}): { data: string; emoChanged: boolean } {
  const parser = env.parser ?? ((value: string) => value);
  let data = parser(input);
  let emoChanged = false;
  if (!rawScripts.length) return { data, emoChanged };

  // 원본: flag의 <...> 메타에서 order·actions를 추출하고 order가 있으면 내림차순 정렬.
  const parsedScripts: PScript[] = [];
  let orderChanged = false;
  for (const raw of rawScripts) {
    const script = { in: String(raw?.in ?? ''), out: String(raw?.out ?? ''), type: String(raw?.type ?? 'editdisplay').toLowerCase(), flag: String(raw?.flag ?? raw?.flags ?? ''), ableFlag: raw?.ableFlag !== false && String(raw?.flag ?? raw?.flags ?? '') !== '' };
    if (script.ableFlag && script.flag.includes('<')) {
      const rregex = /<(.+?)>/g;
      let order = 0;
      const actions: string[] = [];
      script.flag = script.flag.replace(rregex, (_whole: string, p1: string) => {
        for (const m of p1.split(',').map((value) => value.trim())) {
          if (m.startsWith('order ')) { order = parseInt(m.substring(6)); orderChanged = true; }
          else actions.push(m);
        }
        return '';
      });
      parsedScripts.push({ script, order, actions });
      continue;
    }
    parsedScripts.push({ script, order: 0, actions: [] });
  }
  if (orderChanged) parsedScripts.sort((a, b) => b.order - a.order);

  function executeScript(pscript: PScript) {
    const script = pscript.script;
    if (script.in === '') return;
    if (script.type !== mode) return;

    let outScript = script.out.replaceAll('$n', '\n').replace(dreg, '$&');
    let flag = 'g';
    if (script.ableFlag) flag = script.flag || 'g';
    if (outScript.startsWith('@@move_top') || outScript.startsWith('@@move_bottom') || pscript.actions.includes('move_top') || pscript.actions.includes('move_bottom')) flag = flag.replace('g', ''); // 원본 주석: temperary fix
    if (outScript.endsWith('>') && !pscript.actions.includes('no_end_nl')) outScript += '\n';
    flag = flag.trim().replace(/[^dgimsuvy]/g, '');
    flag = flag.split('').filter((v, i, a) => a.indexOf(v) === i).join('');
    if (flag.length === 0) flag = 'u';

    let inputPattern = script.in;
    if (pscript.actions.includes('cbs')) inputPattern = parser(inputPattern);

    const reg = new RegExp(inputPattern, flag);
    if (env.skipScript?.(reg.source)) return;
    if (outScript.startsWith('@@') || pscript.actions.length > 0) {
      if (reg.test(data)) {
        if (outScript.startsWith('@@emo ')) {
          const emoName = script.out.substring(6).trim();
          env.emotionSink?.(emoName);
          emoChanged = true;
        }
        else if (outScript.startsWith('@@inject') || pscript.actions.includes('inject')) {
          env.injectMessageData?.(data);
          data = data.replace(reg, '');
        }
        else if (outScript.startsWith('@@move_top') || outScript.startsWith('@@move_bottom') || pscript.actions.includes('move_top') || pscript.actions.includes('move_bottom')) {
          const isGlobal = flag.includes('g');
          const matchAll = isGlobal ? [...data.matchAll(new RegExp(reg.source, flag.includes('g') ? flag : flag + 'g'))] : [data.match(reg)];
          data = data.replace(reg, '');
          for (const matched of matchAll) {
            if (matched) {
              const inData = matched[0];
              const out = outScript.replace('@@move_top ', '').replace('@@move_bottom ', '')
                .replace(/(?<!\$)\$[0-9]+/g, (v) => { const index = parseInt(v.substring(1)); return index < matched.length ? String(matched[index] ?? v) : v; })
                .replace(/\$&/g, inData)
                .replace(/(?<!\$)\$<([^>]+)>/g, (v) => { const groupName = v.substring(2, v.length - 1); return matched.groups?.[groupName] ?? v; });
              data = outScript.startsWith('@@move_top') || pscript.actions.includes('move_top') ? out + '\n' + data : data + '\n' + out;
            }
          }
        }
        else data = parser(data.replace(reg, outScript));
      }
      else if (outScript.startsWith('@@repeat_back') || pscript.actions.includes('repeat_back')) {
        const v = outScript.split(' ', 2)[1];
        const lastChat = env.previousSameRole?.();
        if (lastChat != null) {
          const r = lastChat.match(reg);
          if (r?.[0]) {
            if (!v) data = data + r[0];
            else switch (v) {
              case 'end': data = data + r[0]; break;
              case 'start': data = r[0] + data; break;
              case 'end_nl': data = data + '\n' + r[0]; break;
              case 'start_nl': data = r[0] + '\n' + data; break;
            }
          }
        }
      }
    }
    else data = parser(data.replace(reg, outScript));
  }

  for (const script of parsedScripts) {
    if (env.outOfBudget?.()) break;
    try { executeScript(script); } catch { /* 원본과 동일: 스크립트 하나의 실패는 나머지를 막지 않는다 */ }
  }

  return { data, emoChanged };
}
