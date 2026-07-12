// null·원시값·undefined는 JSON 왕복 전에 그대로 반환 — 옛 utils.clone 가드 이관.
// (무가드면 cloneState(undefined)가 JSON.parse("undefined")로 SyntaxError. 감사 Minor 잠복.)
export function cloneState<T>(value: T): T { return value === null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value)) as T; }
