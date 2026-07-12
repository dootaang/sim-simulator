import type { JsonObject } from './json.ts';
import type { NavigationItem, ScreenDocument } from './screens.ts';

export interface BlobReference { readonly path: string; readonly sha256: string; readonly size: number; readonly mime: string; }
export interface SimPackAsset { readonly id: string; readonly name: string; readonly kind: string; readonly blob: BlobReference | null; readonly canonical: JsonObject; readonly source: JsonObject | null; }
export interface SimPackManifest {
  readonly contract: 'simpack/0.2'; readonly id: string; readonly title: string; readonly revision: number;
  readonly source: JsonObject; readonly risu: JsonObject | null; readonly personas: JsonObject; readonly prompts: JsonObject; readonly modules: JsonObject; readonly content: JsonObject;
  readonly runtime: JsonObject & { readonly schema: JsonObject | null; readonly screens: readonly ScreenDocument[]; readonly navigation: readonly NavigationItem[] };
  readonly assets: readonly SimPackAsset[]; readonly evidence: readonly JsonObject[]; readonly compatibility: JsonObject; readonly migrations: JsonObject;
}
