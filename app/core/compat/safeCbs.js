// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

// Deliberately small, read-only CBS contract. It never mutates chat/global
// variables and never executes Lua/JS. Unsupported macros remain visible.
const SAFE_NAMES = new Set(['user', 'char', 'bot', 'persona', 'getvar']);
const RE = /\{\{([^{}]+)\}\}/g;

function evaluateSafeCbs(text, context = {}) {
  const warnings = [];
  const warned = new Set();
  const output = String(text == null ? '' : text).replace(RE, (raw, body) => {
    const parts = String(body).split('::');
    const name = parts.shift().trim().toLowerCase();
    if (!SAFE_NAMES.has(name)) {
      warn(name || 'empty');
      return raw;
    }
    if (name === 'user') return String(context.user || 'User');
    if (name === 'char' || name === 'bot') return String(context.char || '');
    if (name === 'persona') return String(context.persona || '');
    const key = String(parts[0] || '').trim();
    if (!key || !Object.prototype.hasOwnProperty.call(context.variables || {}, key)) {
      warn('getvar');
      return raw;
    }
    const value = context.variables[key];
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : raw;
  });
  return { text: output, warnings };

  function warn(detail) {
    if (warned.has(detail)) return;
    warned.add(detail);
    warnings.push({ code: 'unsupported_macro', detail });
  }
}

module.exports = { evaluateSafeCbs, SAFE_NAMES };
