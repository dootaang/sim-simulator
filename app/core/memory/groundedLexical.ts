// SPDX-License-Identifier: GPL-3.0-or-later
// 단어·문자 n-gram·별칭·정규 앵커를 함께 쓰는 Simbot용 결정론 검색기.

import type { MemoryRecord } from './contracts.ts';
import type { LexicalSearchFn, ScoredId } from './groundedPlanner.ts';

const WORD_RE = /[\p{L}\p{N}]+/gu;

function normalize(value: string): string {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function words(value: string): string[] {
  return normalize(value).match(WORD_RE) ?? [];
}

function grams(value: string, size = 2): Set<string> {
  const compact = normalize(value).replace(/[^\p{L}\p{N}]/gu, '');
  const out = new Set<string>();
  for (let i = 0; i <= compact.length - size; i += 1) out.add(compact.slice(i, i + size));
  return out;
}

function overlapRatio(query: Set<string>, document: Set<string>): number {
  if (!query.size) return 0;
  let matched = 0;
  for (const token of query) if (document.has(token)) matched += 1;
  return matched / query.size;
}

interface IndexedRecord {
  record: MemoryRecord;
  normalizedText: string;
  wordSet: Set<string>;
  bigrams: Set<string>;
  anchors: string[];
}

export interface GroundedLexicalIndex {
  records: IndexedRecord[];
}

export function buildGroundedLexicalIndex(records: MemoryRecord[]): GroundedLexicalIndex {
  return {
    records: records.map((record) => {
      const anchors = [...(record.canonicalAnchors ?? []), ...record.entities].map(normalize).filter(Boolean);
      const searchable = [record.text, ...anchors, record.sceneId ?? '', record.sourceLocator?.sceneId ?? ''].join(' ');
      return {
        record,
        normalizedText: normalize(searchable),
        wordSet: new Set(words(searchable)),
        bigrams: grams(searchable),
        anchors,
      };
    }),
  };
}

export function searchGroundedLexical(index: GroundedLexicalIndex, query: string, k: number): ScoredId[] {
  const normalizedQuery = normalize(query);
  const queryWords = new Set(words(query));
  const queryBigrams = grams(query);

  return index.records
    .map((item) => {
      const wordCoverage = overlapRatio(queryWords, item.wordSet);
      const gramCoverage = overlapRatio(queryBigrams, item.bigrams);
      const exactAnchor = item.anchors.some((anchor) => anchor.length >= 2 && normalizedQuery.includes(anchor));
      const exactPhrase = normalizedQuery.length >= 4 && item.normalizedText.includes(normalizedQuery);
      // 절대 근거 점수다. 결과 목록의 1등이라는 이유만으로 1.0이 되지 않는다.
      const score = Math.min(1, wordCoverage * 0.55 + gramCoverage * 0.30 + (exactAnchor ? 0.10 : 0) + (exactPhrase ? 0.05 : 0));
      return { recordId: item.record.id, score, evidenceScore: score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => (b.score - a.score) || a.recordId.localeCompare(b.recordId))
    .slice(0, Math.max(0, k));
}

export function createGroundedLexicalSearch(records: MemoryRecord[]): LexicalSearchFn {
  const index = buildGroundedLexicalIndex(records);
  return (query, k) => searchGroundedLexical(index, query, k);
}
