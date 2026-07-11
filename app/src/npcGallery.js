export function buildNpcClusters(parsed, lore) {
  const assets = (parsed && parsed.assets ? parsed.assets : []).filter(isImageAsset);
  const byId = new Map();
  for (const asset of assets) {
    const parsedName = parseSpriteName(asset.name || '', asset.ext || '');
    if (!byId.has(parsedName.charId)) {
      byId.set(parsedName.charId, { charId: parsedName.charId, emotions: new Map(), profile: null });
    }
    const group = byId.get(parsedName.charId);
    if (!group.emotions.has(parsedName.emotion)) group.emotions.set(parsedName.emotion, []);
    group.emotions.get(parsedName.emotion).push({ asset, variant: parsedName.variant });
  }

  const entries = ((lore && lore.entries) || []).filter((entry) => !entry.isFolder);
  for (const group of byId.values()) group.profile = findProfile(group.charId, entries);

  const groups = Array.from(byId.values()).sort((a, b) => a.charId.localeCompare(b.charId));
  return {
    groups,
    linkedCount: groups.filter((group) => group.profile).length,
  };
}

export function renderNpcGallery(container, ctx) {
  const model = buildNpcClusters(ctx.parsed, ctx.lore);
  let observer = null;

  const header = document.createElement('div');
  header.className = 'view-header';
  const title = document.createElement('h2');
  title.textContent = 'NPC 갤러리';
  const meta = document.createElement('p');
  meta.textContent = `${model.groups.length}개 스프라이트 클러스터 · 로어북 연결 ${model.linkedCount}개`;
  header.append(title, meta);

  const grid = document.createElement('div');
  grid.className = 'npc-grid';
  container.append(header, grid);

  observer = new IntersectionObserver((items) => {
    for (const item of items) {
      if (!item.isIntersecting) continue;
      loadImage(item.target, ctx);
      observer.unobserve(item.target);
    }
  }, { rootMargin: '240px' });

  for (const group of model.groups) {
    const card = renderNpcCard(group, ctx, observer);
    grid.append(card);
  }

  return () => {
    if (observer) observer.disconnect();
  };
}

function renderNpcCard(group, ctx, observer) {
  const card = document.createElement('article');
  card.className = 'npc-card';

  const imageWrap = document.createElement('div');
  imageWrap.className = 'npc-image-wrap';
  const img = document.createElement('img');
  img.className = 'lazy-img npc-image';
  img.alt = displayName(group);
  img.loading = 'lazy';
  imageWrap.append(img);

  const initial = selectAsset(group, preferredEmotion(group));
  img.dataset.assetName = initial.asset.name;
  img._asset = initial.asset;
  observer.observe(img);

  const body = document.createElement('div');
  body.className = 'npc-body';
  const h3 = document.createElement('h3');
  h3.textContent = displayName(group);
  const linked = document.createElement('div');
  linked.className = group.profile ? 'link-state linked' : 'link-state';
  linked.textContent = group.profile ? '로어북 연결' : '스프라이트만';

  const chips = document.createElement('div');
  chips.className = 'chip-row';
  for (const emotion of orderedEmotions(group)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = emotion;
    button.addEventListener('click', () => {
      const pick = selectAsset(group, emotion);
      if (!pick) return;
      img.removeAttribute('src');
      img._asset = pick.asset;
      loadImage(img, ctx);
    });
    chips.append(button);
  }

  body.append(h3, linked, chips);

  if (group.profile) {
    const details = document.createElement('details');
    details.className = 'profile-details';
    const summary = document.createElement('summary');
    summary.textContent = '프로필 원문';
    const keys = document.createElement('div');
    keys.className = 'muted-line';
    keys.textContent = group.profile.keys.join(', ');
    const pre = document.createElement('pre');
    pre.textContent = group.profile.content;
    details.append(summary, keys, pre);
    body.append(details);
  }

  card.append(imageWrap, body);
  return card;
}

function loadImage(img, ctx) {
  const asset = img._asset;
  if (!asset) return;
  const url = ctx.objectUrlFor(asset);
  if (!url) {
    img.alt = `${img.alt} 이미지를 표시할 수 없음`;
    img.classList.add('broken');
    return;
  }
  img.src = url;
}

function parseSpriteName(name, ext) {
  let base = String(name || '');
  const suffix = ext ? `.${String(ext).toLowerCase()}` : '';
  if (suffix && base.toLowerCase().endsWith(suffix)) base = base.slice(0, -suffix.length);
  const parts = base.split('_').filter(Boolean);
  if (parts.length < 2) return { charId: '기타', emotion: base || 'default', variant: null };
  const charId = parts[0].toLowerCase();
  let variant = null;
  if (/^\d+$/.test(parts[parts.length - 1])) variant = Number(parts.pop());
  const emotion = parts.slice(1).join('_') || 'default';
  return { charId, emotion, variant };
}

function findProfile(charId, entries) {
  const id = String(charId).toLowerCase();
  return entries.find((entry) => {
    const keys = Array.isArray(entry.keys) ? entry.keys : [];
    return keys.some((key) => latinTokenIncludes(String(key).toLowerCase(), id));
  }) || null;
}

function latinTokenIncludes(value, id) {
  if (!id || !/^[a-z0-9]+$/.test(id)) return value.includes(id);
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(value);
}

function displayName(group) {
  return (group.profile && group.profile.name) || group.charId;
}

export function preferredEmotion(group) {
  const names = Array.from(group.emotions.keys());
  return names.find((x) => x === 'default') ||
    names.find((x) => x === 'neutral') ||
    names.find((x) => x === 'normal') ||
    names.find((x) => x === 'smile') ||
    names[0];
}

function orderedEmotions(group) {
  const names = Array.from(group.emotions.keys()).sort((a, b) => a.localeCompare(b));
  const preferred = ['default', 'neutral', 'normal', 'smile'];
  return names.sort((a, b) => rankEmotion(a, preferred) - rankEmotion(b, preferred));
}

function rankEmotion(name, preferred) {
  const index = preferred.indexOf(name);
  return index < 0 ? preferred.length : index;
}

export function selectAsset(group, emotion, variant) {
  const items = group.emotions.get(emotion);
  if (!items || !items.length) return null;
  if (typeof variant === 'number' && Number.isFinite(variant)) {
    const exact = items.find((item) => item.variant === variant);
    if (exact) return exact;
  }
  return items[stableIndex(`${group.charId}:${emotion}`, items.length)];
}

function stableIndex(value, length) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function isImageAsset(asset) {
  const mime = String(asset.mime || '').toLowerCase();
  const ext = String(asset.ext || '').toLowerCase();
  return mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(ext);
}
