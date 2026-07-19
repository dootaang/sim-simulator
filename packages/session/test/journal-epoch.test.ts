import { describe, expect, it } from "vitest";
import { ModuleRegistry, type ModuleDefinition } from "@simbot/kernel";
import { defaultCardPreset } from "@simbot/risu";
import { ProjectRuntime, type RuntimeProject } from "@simbot/runtime";
import { createMemoryRepository } from "@simbot/persistence";
import { PlaySession, sessionIntegrity, sessionIntegrityV2, type SessionSnapshot } from "../src/index.ts";

const provider = {
  async complete() {
    return { text: "기록을 남겼다.", events: [{ id: "test/inc" }], memories: [{ text: "이전 에폭의 기억" }] };
  },
};

function project(revision: number, step: number): RuntimeProject {
  return {
    projectId: "epoch-test",
    schema: { revision, step, initialState: { count: 0 } },
    screens: [], navigation: [], content: {}, featureToggles: {}, moduleIds: [], modelEventIds: ["test/inc"],
  };
}
function module(migration: "ok" | "throw" = "ok"): ModuleDefinition {
  return {
    id: "test.epoch", version: "1.0.0", stateAccess: { owns: ["count"], reads: [], writes: [] },
    events: {
      "test/inc": (context) => {
        context.state.count = Number(context.state.count ?? 0) + Number(context.schema.step ?? 1);
        return { state: context.state, log: [{ ok: true, event: "test/inc", count: context.state.count }] };
      },
    },
    migrations: {
      seal: migration === "throw"
        ? () => { throw new Error("test_seal_boom"); }
        : (state) => ({ ...state, migrated: true }),
    },
  };
}
function session(revision: number, step: number, migration: "ok" | "throw" = "ok") {
  const registry = new ModuleRegistry().register(module(migration));
  return new PlaySession({
    id: "epoch-session",
    runtime: new ProjectRuntime(project(revision, step), 7, registry),
    preset: defaultCardPreset(), card: { name: "Epoch" }, provider,
  });
}
function resign(snapshot: SessionSnapshot) {
  const base = structuredClone(snapshot) as SessionSnapshot;
  delete (base as Partial<SessionSnapshot>).integrity;
  base.integrity = base.integrityVersion === 2 ? sessionIntegrityV2(base).integrity : sessionIntegrity(base);
  return base;
}

describe("save epochs", () => {
  it("fingerprint 진화를 봉인·이주하고 메시지·기억과 전역 사건 인덱스를 이어 간다", async () => {
    const old = session(1, 1);
    await old.send("첫 기록");
    const saved = old.snapshot(), oldHead = saved.journal!.head.index;
    expect(oldHead).toBe(1);

    const current = session(2, 99);
    current.restore(saved);
    expect(current.runtime.state).toMatchObject({ count: 1, migrated: true });
    expect(current.messages.map((message) => message.content)).toEqual([
      "첫 기록", "기록을 남겼다.",
      "엔진이 업데이트되어 이전 기록을 봉인하고 이어갑니다. 되돌리기는 이 지점 이후부터 가능합니다.",
    ]);
    expect(current.memory.all().some((entry) => entry.text === "이전 에폭의 기억")).toBe(true);
    expect(current.lastLogs.at(-1)).toMatchObject({ kind: "card", code: "session_epoch_sealed", baseIndex: 1 });
    expect(current.journal).toMatchObject({ contract: "simbot-event-journal/0.2", baseIndex: 1, events: [] });
    expect(current.journal.sealedEpochs).toHaveLength(1);
    expect(current.journal.sealedEpochs[0]?.sealHash).toMatch(/^[0-9a-f]{64}$/);
    expect(() => current.stateAt(0)).toThrow(/epoch_sealed/);
    await expect(current.truncateTo(0)).rejects.toThrow(/epoch_sealed/);
    expect(current.stateAt(1).state).toMatchObject({ count: 1, migrated: true });

    current.runtime.dispatch("test/inc");
    expect(current.journal.events[0]).toMatchObject({ index: 2, parentIndex: 1 });
    expect(current.journal.sealedEpochs[0]?.events[0]).toMatchObject({ index: 1 });
    expect(current.eventCount).toBe(2);
  });

  it("봉인 경계 이전 undo·대안을 버리고 이후 undo는 경계에서 멈춘다", async () => {
    const old = session(1, 1);
    await old.send("첫 기록");
    await old.reroll();
    expect(old.checkpointDepth).toBeGreaterThan(0);
    expect(old.alternateCount).toBeGreaterThan(0);
    const current = session(2, 1);
    current.restore(old.snapshot());
    expect(current.checkpointDepth).toBe(0);
    expect(current.redoDepth).toBe(0);
    expect(current.alternateCount).toBe(0);
    await expect(current.undoTurn()).rejects.toThrow("no_checkpoint");
    await current.send("새 에폭 기록");
    await current.undoTurn();
    expect(current.eventCursor).toBe(current.journal.baseIndex);
    await expect(current.undoTurn()).rejects.toThrow("no_checkpoint");
  });

  it("sealHash 변조와 바깥 integrity 변조를 서로 다른 손상으로 거부한다", async () => {
    const old = session(1, 1);
    await old.send("첫 기록");
    const current = session(2, 1);
    current.restore(old.snapshot());
    const evolved = current.snapshot(), sealForged = structuredClone(evolved);
    (sealForged.journal as any).sealedEpochs[0].sealHash = "0".repeat(64);
    expect(() => session(2, 1).restore(resign(sealForged))).toThrow(/journal_corrupt:sealed_epoch_1_hash/);
    const integrityForged = structuredClone(evolved);
    integrityForged.messages[0]!.content = "변조";
    expect(() => session(2, 1).restore(integrityForged)).toThrow(/session_corrupt:integrity/);
  });

  it("v0.1 원장은 같은 fingerprint에서 기존 재생 검증을 그대로 통과하고 v0.2로 저장된다", async () => {
    const source = session(1, 1);
    await source.send("기록");
    const snapshot = source.snapshot(), journal = snapshot.journal!;
    const legacy = resign({
      ...snapshot,
      journal: {
        contract: "simbot-event-journal/0.1",
        schemaHash: journal.schemaHash,
        initial: journal.initial,
        snapshotInterval: journal.snapshotInterval,
        events: journal.events,
        cursor: journal.cursor,
        head: journal.head,
      },
    });
    const restored = session(1, 1);
    restored.restore(legacy);
    expect(restored.runtime.snapshot()).toEqual(source.runtime.snapshot());
    expect(restored.journal).toMatchObject({ contract: "simbot-event-journal/0.2", baseIndex: 0, sealedEpochs: [] });
  });

  it("seal 이주 예외는 복구를 중단해 기존 격리 경로로 실패한다", async () => {
    const old = session(1, 1);
    await old.send("기록");
    expect(() => session(2, 1, "throw").restore(old.snapshot())).toThrow("test_seal_boom");
  });
});

describe("봉인 에폭 분리 보관 — 파동 2", () => {
  async function sealedSetup() {
    const repository = createMemoryRepository<SessionSnapshot>(),
      first = new PlaySession({ id: "epoch-split", runtime: new ProjectRuntime(project(1, 1), 7, new ModuleRegistry().register(module())), preset: defaultCardPreset(), card: { name: "Epoch" }, provider, repository });
    await first.send("hello");
    await first.send("again");
    // 스키마 개정 → 로드 시 봉인 발생
    const second = new PlaySession({ id: "epoch-split", runtime: new ProjectRuntime(project(2, 5), 7, new ModuleRegistry().register(module())), preset: defaultCardPreset(), card: { name: "Epoch" }, provider, repository });
    second.restore(await PlaySession.assembleSnapshot((await repository.get("epoch-split"))!.payload, repository));
    await second.save(); // 봉인 본문이 별도 레코드로 1회 기록된다
    return { repository, second };
  }
  it("핫 저장은 참조만 들고, 본문 레코드와 조립해 리플레이 왕복이 성립한다", async () => {
    const { repository, second } = await sealedSetup();
    const hot = (await repository.get("epoch-split"))!.payload;
    expect(hot.journal?.contract).toBe("simbot-event-journal/0.2");
    if (hot.journal?.contract !== "simbot-event-journal/0.2") return;
    expect(hot.journal.sealedEpochs).toHaveLength(0); // 본문 없음
    expect(hot.journal.sealedEpochRefs).toHaveLength(1); // 참조만
    const body = await repository.get(PlaySession.sealedEpochRecordId("epoch-split", 0));
    expect(body).toBeTruthy(); // 분리 레코드 존재
    const third = new PlaySession({ id: "epoch-split", runtime: new ProjectRuntime(project(2, 5), 7, new ModuleRegistry().register(module())), preset: defaultCardPreset(), card: { name: "Epoch" }, provider, repository });
    third.restore(await PlaySession.assembleSnapshot(hot, repository));
    expect(third.runtime.snapshot()).toEqual(second.runtime.snapshot()); // 조립 왕복 등가
  });
  it("본문 변조는 sealHash로, 참조 변조는 integrity로, 본문 누락은 조립 오류로 잡힌다", async () => {
    const { repository } = await sealedSetup();
    const hot = (await repository.get("epoch-split"))!.payload;
    // ① 본문 1바이트 변조
    const recordId = PlaySession.sealedEpochRecordId("epoch-split", 0),
      body = (await repository.get(recordId))!;
    (body.payload as unknown as { epoch: { sealHash: string } }).epoch.sealHash = "tampered";
    await repository.put(body);
    await expect(PlaySession.assembleSnapshot(hot, repository)).rejects.toThrow("sealed_epoch_record_0");
    // ② 참조 변조 → integrity 거부 (샤드는 정상 조립 후 참조만 위조)
    const cleanBody = structuredClone(body); (cleanBody.payload as unknown as { epoch: { sealHash: string } }).epoch.sealHash = String((hot.journal?.contract === "simbot-event-journal/0.2" ? hot.journal.sealedEpochRefs?.[0]?.sealHash : "") ?? "");
    await repository.put(cleanBody); // 본문 원복
    const assembled = await PlaySession.assembleSnapshot(hot, repository), forged = structuredClone(assembled);
    if (forged.journal?.contract === "simbot-event-journal/0.2" && forged.journal.sealedEpochRefs)
      (forged.journal.sealedEpochRefs as unknown as Array<{ sealHash: string }>)[0]!.sealHash = "forged";
    const victim = new PlaySession({ id: "epoch-split", runtime: new ProjectRuntime(project(2, 5), 7, new ModuleRegistry().register(module())), preset: defaultCardPreset(), card: { name: "Epoch" }, provider, repository });
    expect(() => victim.restore(forged)).toThrow("session_corrupt:integrity");
    // ③ 봉인 본문 없이 restore → 본문 누락 오류 (샤드는 조립된 상태)
    const bodiless = structuredClone(assembled); delete (bodiless as Partial<SessionSnapshot>).sealedEpochBodies;
    expect(() => victim.restore(bodiless)).toThrow("journal_epoch_bodies_missing");
    // ④ 샤딩 코어를 조립 없이 restore → 명시적 샤드 누락 오류
    expect(() => victim.restore(hot)).toThrow("session_shards_missing");
  });
  it("구형 인라인 스냅샷은 그대로 로드되고 다음 save에서 분리형으로 승격된다", async () => {
    const { repository } = await sealedSetup();
    // 인라인 백업(자기완결 snapshot())을 구형 저장으로 가장
    const fresh = new PlaySession({ id: "epoch-legacy", runtime: new ProjectRuntime(project(2, 5), 7, new ModuleRegistry().register(module())), preset: defaultCardPreset(), card: { name: "Epoch" }, provider, repository });
    const donor = (await repository.get("epoch-split"))!.payload,
      assembled = await PlaySession.assembleSnapshot(donor, repository);
    fresh.restore(assembled);
    const inline = resign({ ...fresh.snapshot(), id: "epoch-legacy" }); // 본문 인라인 스냅샷
    expect(inline.journal?.contract).toBe("simbot-event-journal/0.2");
    if (inline.journal?.contract === "simbot-event-journal/0.2") expect(inline.journal.sealedEpochs.length).toBe(1);
    const upgraded = new PlaySession({ id: "epoch-legacy", runtime: new ProjectRuntime(project(2, 5), 7, new ModuleRegistry().register(module())), preset: defaultCardPreset(), card: { name: "Epoch" }, provider, repository });
    upgraded.restore(inline); // 조립 없이도 로드된다(하위호환)
    await upgraded.save();
    const hot = (await repository.get("epoch-legacy"))!.payload;
    if (hot.journal?.contract === "simbot-event-journal/0.2") {
      expect(hot.journal.sealedEpochs).toHaveLength(0);
      expect(hot.journal.sealedEpochRefs).toHaveLength(1); // 승격 완료
    }
    expect(await repository.get(PlaySession.sealedEpochRecordId("epoch-legacy", 0))).toBeTruthy();
  });
});
