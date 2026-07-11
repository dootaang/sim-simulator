// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const STAGES = ['editinput', 'editrequest', 'editoutput', 'editdisplay'];

function normalizeRegexScripts(sources) {
  const scripts = [];
  const issues = [];
  for (const source of sources || []) {
    const scope = String(source && source.scope || 'character');
    const list = Array.isArray(source && source.scripts) ? source.scripts : [];
    list.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const stage = raw.type === 'editprocess' ? 'editrequest' : String(raw.type || '');
      const id = `${scope}:${index}`;
      if (!STAGES.includes(stage)) { issues.push({ id, level: 'warn', reason: 'unsupported_stage', detail: stage }); return; }
      const pattern = String(raw.in || '');
      const replacement = String(raw.out || '').replaceAll('$n', '\n');
      const safety = inspectPattern(pattern, replacement);
      scripts.push({ id, name: String(raw.comment || id), scope, stage, pattern, replacement, flags: normalizeFlags(raw), enabled: raw.enabled !== false, safe: safety.ok, blockedReason: safety.reason, raw });
      if (!safety.ok) issues.push({ id, level: 'blocked', reason: safety.reason });
    });
  }
  return { scripts, issues };
}

function applyRegexStage(text, scripts, stage) {
  if (!STAGES.includes(stage)) throw new TypeError('unknown_regex_stage');
  let output = String(text == null ? '' : text);
  const trace = [];
  for (const script of scripts || []) {
    if (!script || script.stage !== stage || script.enabled === false) continue;
    if (!script.safe) { trace.push({ id: script.id, status: 'blocked', reason: script.blockedReason }); continue; }
    try {
      const regex = new RegExp(script.pattern, script.flags);
      const before = output;
      output = output.replace(regex, script.replacement);
      trace.push({ id: script.id, status: before === output ? 'no_match' : 'applied' });
    } catch (error) {
      trace.push({ id: script.id, status: 'invalid', reason: error.message || String(error) });
    }
  }
  return { text: output, trace };
}

function inspectPattern(pattern, replacement) {
  if (!pattern) return { ok: false, reason: 'empty_pattern' };
  if (pattern.length > 512 || replacement.length > 10000) return { ok: false, reason: 'size_limit' };
  if (/^@@|<script|<iframe|javascript:/i.test(replacement.trim())) return { ok: false, reason: 'action_or_active_content' };
  // Conservative ReDoS guard: nested quantified groups and quantified wildcards.
  if (/\((?:[^()]|\\.)*[+*](?:[^()]|\\.)*\)[+*{]/.test(pattern) || /(?:\.\*){2,}|(?:\.\+){2,}/.test(pattern)) return { ok: false, reason: 'unsafe_quantifier' };
  try { new RegExp(pattern, 'u'); } catch (_) { return { ok: false, reason: 'invalid_pattern' }; }
  return { ok: true, reason: '' };
}

function normalizeFlags(raw) {
  const requested = raw && raw.ableFlag ? String(raw.flag || 'g') : 'g';
  const unique = Array.from(new Set(requested.replace(/[^gimsuy]/g, '').split(''))).join('');
  return unique || 'u';
}

module.exports = { STAGES, normalizeRegexScripts, applyRegexStage, inspectPattern };

