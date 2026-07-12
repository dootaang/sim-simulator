export type KnowledgeScope = { readonly kind: 'public' } | { readonly kind: 'user'; readonly userId: string } | { readonly kind: 'entity'; readonly entityId: string };
export interface EvidenceReference { readonly kind: 'message' | 'event'; readonly id: string; }
export interface MemoryRecord { readonly id: string; readonly text: string; readonly validFromTurn: number; readonly validToTurn: number | null; readonly scope: KnowledgeScope; readonly evidence: readonly EvidenceReference[]; readonly status: 'candidate' | 'approved' | 'rejected' | 'superseded'; }
