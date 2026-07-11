// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const SCOPE_PRIORITY = { global: 0, preset: 1, character: 2, chat: 3, persona: 4, embedded: 5 };

function resolveModuleBindings(bindings) {
  const issues = [];
  const byKey = new Map();
  for (const binding of bindings || []) {
    if (!binding || typeof binding !== 'object') continue;
    const scope = Object.hasOwn(SCOPE_PRIORITY, binding.scope) ? binding.scope : 'embedded';
    const namespace = String(binding.namespace || '').trim();
    const id = String(binding.id || binding.name || '').trim();
    if (!id) { issues.push({ level: 'warn', reason: 'missing_id' }); continue; }
    const key = namespace || id;
    const normalized = { ...binding, id, scope, namespace, enabled: binding.enabled !== false };
    const previous = byKey.get(key);
    if (!previous || SCOPE_PRIORITY[scope] >= SCOPE_PRIORITY[previous.scope]) {
      if (previous) issues.push({ level: 'info', reason: 'shadowed', key, kept: id, dropped: previous.id });
      byKey.set(key, normalized);
    } else issues.push({ level: 'info', reason: 'shadowed', key, kept: previous.id, dropped: id });
  }
  const modules = Array.from(byKey.values()).sort((a, b) => SCOPE_PRIORITY[a.scope] - SCOPE_PRIORITY[b.scope] || a.id.localeCompare(b.id));
  return { modules, issues };
}

function normalizeRisuModule(module, scope = 'embedded', sourcePath = '$.module') {
  const raw = module && typeof module === 'object' ? module : {};
  const executable = !!(raw.cjs || raw.mcp || raw.lowLevelAccess || (raw.trigger || []).some((trigger) => trigger && (trigger.lowLevelAccess || (trigger.effect || []).some((effect) => /lua|command/i.test(String(effect && effect.type))))));
  return {
    id: String(raw.id || raw.namespace || raw.name || 'module'), name: String(raw.name || 'Risu module'),
    namespace: String(raw.namespace || ''), scope, enabled: true, lowLevelAccess: !!raw.lowLevelAccess,
    capabilities: [Array.isArray(raw.lorebook) && raw.lorebook.length ? 'lorebook' : '', Array.isArray(raw.regex) && raw.regex.length ? 'regex' : '', Array.isArray(raw.trigger) && raw.trigger.length ? 'trigger' : '', Array.isArray(raw.assets) && raw.assets.length ? 'assets' : '', raw.customModuleToggle ? 'toggle' : '', raw.backgroundEmbedding ? 'background' : ''].filter(Boolean),
    execution: executable ? 'blocked' : 'data-only', raw,
    provenance: { source: 'module', path: sourcePath },
  };
}

module.exports = { SCOPE_PRIORITY, resolveModuleBindings, normalizeRisuModule };
