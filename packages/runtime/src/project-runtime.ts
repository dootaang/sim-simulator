import {
  createRng,
  createState,
  ModuleRegistry,
  type DispatchResult,
  type RuntimeRecord,
} from "@simbot/kernel";
import { MODULE_CATALOG } from "@simbot/modules";
export interface RuntimeProject {
  projectId: string;
  schema: RuntimeRecord;
  screens: RuntimeRecord[];
  navigation: RuntimeRecord[];
  content: RuntimeRecord;
  featureToggles: RuntimeRecord;
  moduleIds?: string[];
  modelEventIds?: string[];
}

// createCoreRegistry()가 역사적으로 항상 등록하던 호환 묶음이다. 개별 ID에는 이 묶음을
// 강제하지 않으며, 과거 전체 이벤트 계약을 보존해야 하는 장르 프리셋에만 사용한다.
const LEGACY_CORE_MODULE_IDS = [
  "core.stats",
  "core.inventory",
  "core.progression",
  "rpg.party",
  "core.time",
  "core.location",
  "rpg.loot",
  "core.factions",
  "core.jobs",
  "core.equipment",
  "rpg.quests",
  "rpg.shop",
  "rpg.crafting",
  "combat.turnbased",
] as const;

export interface RegistryAssembly {
  registry: ModuleRegistry;
  unknownModuleIds: string[];
}
export function registryFor(project: RuntimeProject): RegistryAssembly {
  const registry = new ModuleRegistry(),
    unknownModuleIds: string[] = [];
  // moduleIds 미지정은 API 이전 호출의 하위 호환이다. 명시적인 []는 일반 채팅 모드라서 비워 둔다.
  // 단, meta조차 없던 구형 직접-런타임 문서가 화면에 코어 액션을 박아 둔 경우에는 그 액션의
  // 소유 모듈만 복원한다. 정식 SimPack(meta 보유)이나 빈 채팅 화면에는 적용되지 않는 이행 어댑터다.
  const legacyInferred =
    project.moduleIds?.length === 0 && !objectRecord(project.schema.meta)
      ? legacyModulesFromScreens(project.screens)
      : [];
  const requested =
    project.moduleIds === undefined
      ? [...LEGACY_CORE_MODULE_IDS]
      : [
          ...new Set(
            project.moduleIds.length ? project.moduleIds : legacyInferred,
          ),
        ];
  const expanded: string[] = [];
  for (const id of requested) {
    if (id === "genre.inn" || id === "genre.inn.traffic")
      expanded.push(
        ...LEGACY_CORE_MODULE_IDS,
        "genre.inn",
        "genre.inn.traffic",
      );
    else if (id === "genre.hunter")
      expanded.push(...LEGACY_CORE_MODULE_IDS, "genre.hunter");
    else if (id === "genre.gfl")
      expanded.push(...LEGACY_CORE_MODULE_IDS, "genre.gfl");
    else expanded.push(id);
  }
  const registered = new Set<string>(),
    visiting = new Set<string>();
  const install = (id: string, reported: boolean) => {
    if (registered.has(id)) return;
    const factory = MODULE_CATALOG[id];
    if (!factory) {
      if (reported && !unknownModuleIds.includes(id)) unknownModuleIds.push(id);
      return;
    }
    if (visiting.has(id)) throw new Error(`cyclic_module_dependency:${id}`);
    visiting.add(id);
    const definition = factory();
    for (const dependency of definition.dependencies ?? [])
      install(dependency, false);
    visiting.delete(id);
    if (!registered.has(id)) {
      registry.register(definition);
      registered.add(id);
    }
  };
  for (const id of expanded) install(id, requested.includes(id));
  return { registry, unknownModuleIds };
}

function objectRecord(value: unknown): value is RuntimeRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function legacyModulesFromScreens(screens: RuntimeRecord[]) {
  const ids = new Set<string>();
  for (const screen of screens) collectEventIds(screen, ids, new Set());
  if (!ids.size) return [];
  const owners: string[] = [];
  for (const moduleId of LEGACY_CORE_MODULE_IDS) {
    const definition = MODULE_CATALOG[moduleId]?.();
    if (
      definition &&
      Object.keys(definition.events ?? {}).some((id) => ids.has(id))
    )
      owners.push(moduleId);
  }
  return owners;
}
export class ProjectRuntime {
  readonly project: RuntimeProject;
  readonly registry: ModuleRegistry;
  readonly unknownModuleIds: string[];
  #state: RuntimeRecord;
  #rng;
  #listeners = new Set<() => void>();
  constructor(
    project: RuntimeProject,
    seed: unknown = 1,
    registry?: ModuleRegistry,
  ) {
    this.project = project;
    const assembly = registryFor(project);
    this.registry = registry ?? assembly.registry;
    this.unknownModuleIds = assembly.unknownModuleIds;
    this.#state = createState(project.schema, seed);
    this.#rng = createRng(seed);
  }
  get state() {
    return this.#state;
  }
  dispatch(id: string, params: RuntimeRecord = {}): DispatchResult {
    const result = this.registry.dispatch(
      this.project.schema,
      this.#state,
      { id, params },
      this.#rng,
    );
    if (result.log.some((entry) => entry.ok)) this.#state = result.state;
    this.#notify();
    return result;
  }
  peek(id: string, params: RuntimeRecord = {}): DispatchResult {
    const rng = createRng(0);
    rng.restore(this.#rng.snapshot());
    return this.registry.dispatch(
      this.project.schema,
      structuredClone(this.#state),
      { id, params: structuredClone(params) },
      rng,
    );
  }
  select(id: string): unknown {
    return this.registry.select(id, this.project.schema, this.#state);
  }
  promptFacts(): RuntimeRecord {
    return this.registry.promptFacts(this.project.schema, this.#state);
  }
  sealMigrations(state: RuntimeRecord) {
    return this.registry.sealMigrations(this.project.schema, state);
  }
  allowedModelEventIds() {
    const ids = new Set(this.project.modelEventIds ?? []);
    for (const screen of this.project.screens)
      collectEventIds(screen, ids, new Set());
    return [...ids]
      .filter((id) => this.registry.hasEvent(id) && !BUTTON_ONLY_EVENTS.has(id))
      .sort();
  }
  snapshot() {
    return { state: structuredClone(this.#state), rng: this.#rng.snapshot() };
  }
  restore(snapshot: { state: RuntimeRecord; rng: number }) {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !snapshot.state ||
      !Number.isFinite(snapshot.rng)
    )
      throw new Error("runtime_snapshot_invalid");
    this.#state = structuredClone(snapshot.state);
    this.#rng.restore(snapshot.rng);
    this.#notify();
  }
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #notify() {
    for (const listener of this.#listeners) listener();
  }
}
// 버튼 전용 인텐트 — 화면에 플레이어용 버튼으로 선언돼 있어도 LLM이 events로 흉내내 실행하면 안 된다
// (마이그레이션 감사 Critical: 동적 허용목록이 화면 액션을 자동 허용해 traffic_wave 등 이중 발동 치트가 뚫림).
// 옛 buttonOnlyEvents와 동일 목록. 플레이어의 버튼 클릭(dispatch 직접 호출)은 이 목록과 무관하게 허용된다.
export const BUTTON_ONLY_EVENTS = new Set<string>([
  "traffic_wave",
  "incident_choice",
  "lodging_review",
  "lodging_accept",
  "lodging_reject",
  "mail_check",
  "mail_open",
  "purchase_batch",
  "set_scale_mult",
  "set_outfit",
]);

function collectEventIds(
  value: unknown,
  ids: Set<string>,
  seen: Set<object>,
): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectEventIds(item, ids, seen);
    return;
  }
  const entry = value as RuntimeRecord,
    event = entry.event;
  if (event && typeof event === "object" && !Array.isArray(event)) {
    const id = (event as RuntimeRecord).id;
    if (typeof id === "string" && id) ids.add(id);
  }
  for (const nested of Object.values(entry)) collectEventIds(nested, ids, seen);
}
export function runtimeFromManifest(manifest: RuntimeRecord): RuntimeProject {
  const runtime = manifest.runtime as RuntimeRecord,
    content = (manifest.content ?? {}) as RuntimeRecord,
    modules = (manifest.modules ?? {}) as RuntimeRecord,
    options = (runtime?.options ?? {}) as RuntimeRecord,
    installed = Array.isArray(modules.installed) ? modules.installed : [];
  if (!runtime || typeof runtime !== "object" || !runtime.schema)
    throw new Error("runtime_schema_missing");
  return {
    projectId: String(manifest.id ?? "project"),
    schema: runtime.schema as RuntimeRecord,
    screens: Array.isArray(runtime.screens)
      ? (runtime.screens as RuntimeRecord[])
      : [],
    navigation: Array.isArray(runtime.navigation)
      ? (runtime.navigation as RuntimeRecord[])
      : [],
    content,
    featureToggles: (runtime.featureToggles ?? {}) as RuntimeRecord,
    moduleIds: installed
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : String((entry as RuntimeRecord).id ?? ""),
      )
      .filter(Boolean),
    modelEventIds: Array.isArray(options.modelEventIds)
      ? options.modelEventIds.map(String)
      : [],
  };
}
