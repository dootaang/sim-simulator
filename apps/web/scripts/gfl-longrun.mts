import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCard } from "@simbot/card";
import { compileKnownCard } from "@simbot/compiler";
import { cardToRuntimeProject, defaultCardPreset } from "@simbot/risu";
import { ProjectRuntime } from "@simbot/runtime";
import {
  PlaySession,
  sessionIntegrity,
  sessionIntegrityV2,
  type ModelProvider,
  type SessionSnapshot,
} from "@simbot/session";

type Row = Record<string, unknown>;
type Doll = Row & { id: string; hp: { cur: number; max: number } };

const args = process.argv.slice(2).filter((value) => value !== "--");
const cardPath = resolve(
  args[0] ?? "../../../소녀전선/업데이트버전/소녀전선_잔불.png",
);
const parsed = parseCard(new Uint8Array(await readFile(cardPath)), cardPath);
const compiled = compileKnownCard(parsed);
assert(compiled, "실제 소녀전선 카드로 인식되지 않았습니다.");
const profile = cardToRuntimeProject(parsed, compiled);
const seed = 20260718;

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function firstLog(result: { log: Row[] }) {
  return result.log[0] ?? {};
}

function snapshotWithoutIntegrity(snapshot: SessionSnapshot) {
  const { integrity: _integrity, ...base } = snapshot;
  return base;
}

async function run(label: string, verifyEpoch: boolean) {
  const runtime = new ProjectRuntime(profile.project, seed);
  // The harness starts with a deliberately ample testing reserve. This is not a
  // balance input: it prevents a 30-day lifecycle test from stopping at the shop.
  runtime.state.gold = 1_000_000;
  runtime.state.resources = {
    ...(runtime.state.resources as Row),
    res: 1_000_000,
    parts: 1_000_000,
    cores: 1_000_000,
  };

  let llmCalls = 0;
  let captureFreeChat = false;
  const promptChars: number[] = [];
  const provider: ModelProvider = {
    async complete(request) {
      llmCalls += 1;
      const chars =
        request.prompt.messages.reduce(
          (sum, message) => sum + message.content.length,
          0,
        ) + request.prompt.assistantPrefill.length;
      if (captureFreeChat) promptChars.push(chars);
      return {
        text: '[|<img="M4A1_normal">|"M4A1"|] 상태를 확인했습니다.',
        usage: {
          inputTokens: Math.ceil(chars / 4),
          outputTokens: 12,
          totalTokens: Math.ceil(chars / 4) + 12,
        },
        model: "gfl-longrun-mock",
        finishReason: "stop",
      };
    },
  };
  const session = new PlaySession({
    id: "gfl-longrun-fixed-session",
    runtime,
    provider,
    providerInfo: { provider: "mock", model: "gfl-longrun-mock" },
    preset: defaultCardPreset(),
    card: profile.card,
    loreEntries: (profile.project.content as Row).lorebooks as unknown[],
    regexScripts: profile.regexScripts,
    defaultVariables: profile.defaultVariables,
    historyWindow: 40,
    maxContext: 24_000,
  });

  let measuredDispatches = 0;
  const dispatchMsByDay: number[][] = Array.from({ length: 30 }, () => []);
  const violations: string[] = [];
  const roundTrips: Array<{ day: number; hash: string }> = [];
  let sortieStarts = 0;
  let sortieCompletions = 0;

  const checkInvariants = (day: number, event: string) => {
    const state = runtime.state;
    const resources = state.resources as Row;
    if (Number(state.gold) < 0) violations.push(`day ${day} ${event}: negative gold`);
    for (const [key, value] of Object.entries(resources))
      if (typeof value === "number" && value < 0)
        violations.push(`day ${day} ${event}: negative resource ${key}`);
    const dolls = runtime.select("gfl/dolls") as Doll[];
    for (const doll of dolls)
      if (Number(doll.hp.cur) > Number(doll.hp.max))
        violations.push(`day ${day} ${event}: ${doll.id} hp exceeds max`);
    const hire = runtime.select("gfl/hire") as { count: number; capacity: number };
    if (hire.count > hire.capacity)
      violations.push(`day ${day} ${event}: dolls ${hire.count}/${hire.capacity}`);
    const daily = runtime.select("gfl/daily") as {
      sortiesUsed: number;
      sortieLimit: number;
    };
    if (daily.sortiesUsed > daily.sortieLimit)
      violations.push(
        `day ${day} ${event}: sorties ${daily.sortiesUsed}/${daily.sortieLimit}`,
      );
  };

  const dispatch = (day: number, id: string, params: Row = {}) => {
    const started = performance.now();
    const result = runtime.dispatch(id, params);
    dispatchMsByDay[day - 1]!.push(performance.now() - started);
    measuredDispatches += 1;
    checkInvariants(day, id);
    return result;
  };

  const management = async (day: number, id: string, params: Row = {}) => {
    const started = performance.now();
    const result = await session.runManagementTurn(id, params, `${id} 처리`);
    dispatchMsByDay[day - 1]!.push(performance.now() - started);
    measuredDispatches += 1;
    checkInvariants(day, id);
    return result;
  };

  const send = async (day: number, text: string) => {
    captureFreeChat = true;
    try {
      await session.send(text);
    } finally {
      captureFreeChat = false;
    }
    checkInvariants(day, "send");
  };

  const repairDamaged = (day: number) => {
    for (const doll of runtime.select("gfl/dolls") as Doll[]) {
      if (Number(doll.hp.cur) >= Number(doll.hp.max)) continue;
      const started = dispatch(day, "gfl/repair/start", { dollId: doll.id });
      const job = firstLog(started).job as Row | undefined;
      if (job?.id)
        dispatch(day, "gfl/repair/rush", { jobId: job.id });
    }
  };

  const completeSortie = (day: number) => {
    let guard = 0;
    while ((runtime.select("gfl/status") as Row).sortie && guard++ < 20) {
      const status = runtime.select("gfl/status") as Row;
      const sortie = status.sortie as Row;
      const stages = sortie.stages as Row[];
      const stage = stages[Number(sortie.current)] as Row;
      const id = ["battle", "boss"].includes(String(stage.type))
        ? "gfl/sortie/resolve"
        : "gfl/sortie/stage";
      dispatch(day, id, {
        tactic: day % 2 === 0 ? "balanced" : "aggressive",
      });
      const after = runtime.select("gfl/status") as Row;
      if (after.bossRecruit) dispatch(day, "gfl/boss/dismiss");
      const gfl = runtime.state.gfl as Row;
      if (gfl.encounter) dispatch(day, "gfl/encounter/skip");
    }
    assert(guard < 20, `day ${day}: operation stage guard exceeded`);
    if (!(runtime.select("gfl/status") as Row).sortie) sortieCompletions += 1;
  };

  const totalStarted = performance.now();
  const registration = dispatch(1, "gfl/start", { mode: "commander" });
  assert.equal(firstLog(registration).ok, true);
  dispatch(1, "gfl/location/move", { locationId: "base-maintenance" });

  for (let day = 1; day <= 30; day += 1) {
    await management(day, "gfl/hire/refresh");
    const hire = runtime.select("gfl/hire") as {
      offers: Array<{ id: string }>;
      count: number;
      capacity: number;
    };
    if (hire.offers[0])
      dispatch(day, "gfl/hire/contract", { dollId: hire.offers[0].id });
    dispatch(day, "gfl/time/advance");

    const dolls = runtime.select("gfl/dolls") as Doll[];
    const echelon = (runtime.select("gfl/echelons") as Array<Row>)[0]!;
    const assigned = new Set(
      (echelon.slots as Array<{ id: unknown }>).map((slot) => slot.id).filter(Boolean),
    );
    for (const doll of dolls) {
      if (assigned.has(doll.id) || assigned.size >= 6) continue;
      dispatch(day, "gfl/echelon/assign", {
        echelonId: echelon.id,
        slot: assigned.size,
        dollId: doll.id,
      });
      assigned.add(doll.id);
    }

    repairDamaged(day);
    const desiredSorties = 1 + ((day - 1) % 3);
    for (let attempt = 0; attempt < desiredSorties; attempt += 1) {
      const mission = (runtime.select("gfl/missions") as Array<Row>).find(
        (value) => value.unlocked === true,
      );
      if (!mission || assigned.size === 0) break;
      const started = dispatch(day, "gfl/sortie/start", {
        missionId: mission.id,
        echelonId: echelon.id,
        missionType: ["sweep", "annihil", "recon"][attempt % 3],
        engagementMode: attempt % 2 === 0 ? "tactical" : "quick",
        command: "remote",
      });
      if (firstLog(started).ok !== true) break;
      sortieStarts += 1;
      completeSortie(day);
      repairDamaged(day);
    }

    const featured = (runtime.select("gfl/dolls") as Doll[])[0];
    if (featured) {
      dispatch(day, "gfl/relation/session/start", { dollId: featured.id });
      dispatch(day, "gfl/relation/check", { dollId: featured.id, choice: "talk" });
      const choices = (((runtime.select("gfl/relation/options") as Row).dolls as Row)[
        featured.id
      ] as Row).choices as Row[];
      const second = choices.find(
        (choice) => choice.available === true && choice.id !== "talk",
      );
      if (second)
        dispatch(day, "gfl/relation/check", {
          dollId: featured.id,
          choice: second.id,
        });
      dispatch(day, "gfl/relation/session/end");

      const usable = ((runtime.select("gfl/shop") as Row).catalog as Row[]).find(
        (item) => item.type === "use",
      );
      if (usable) {
        dispatch(day, "gfl/shop/buy", { itemId: usable.id });
        dispatch(day, "gfl/item/use", { itemId: usable.id, dollId: featured.id });
      }
    }

    await send(day, `${day}일차 첫 번째 자유 대화`);
    await send(day, `${day}일차 두 번째 자유 대화`);
    dispatch(day, "gfl/time/advance");
    await management(day, "gfl/time/end-day");

    if (day % 10 === 0) {
      const before = session.snapshot();
      const beforeHash = hash(before.engine);
      const messages = before.messages.length;
      const memory = before.memory.length;
      session.restore(before);
      const after = session.snapshot();
      assert.equal(hash(after.engine), beforeHash, `day ${day}: engine round-trip`);
      assert.equal(after.messages.length, messages, `day ${day}: messages round-trip`);
      assert.equal(after.memory.length, memory, `day ${day}: memory round-trip`);
      roundTrips.push({ day, hash: beforeHash });
    }
  }

  const totalMs = performance.now() - totalStarted;
  const finalBeforeEpoch = session.snapshot();
  const finalStateHash = hash(finalBeforeEpoch.engine);
  let epoch: Row | null = null;
  if (verifyEpoch) {
    const forgedBase = {
      ...snapshotWithoutIntegrity(finalBeforeEpoch),
      schemaFingerprint: "forged-previous-epoch",
    };
    const forged = {
      ...forgedBase,
      integrity:
        (forgedBase as SessionSnapshot).integrityVersion === 2
          ? sessionIntegrityV2(forgedBase as SessionSnapshot).integrity
          : sessionIntegrity(forgedBase),
    } as SessionSnapshot;
    const messageCount = forged.messages.length;
    const memoryHash = hash(forged.memory);
    session.restore(forged);
    const sealed = session.snapshot();
    const diagnostics = sealed.lastLogs.filter(
      (row) => row.code === "session_epoch_sealed",
    );
    assert.equal(diagnostics.length, 1, "epoch seal diagnostic must occur once");
    assert.equal(sealed.messages.length, messageCount + 1, "epoch notice count");
    assert.equal(hash(sealed.messages.slice(0, messageCount)), hash(forged.messages));
    assert.equal(hash(sealed.memory), memoryHash, "epoch memory preservation");
    epoch = {
      sealed: true,
      diagnosticCount: diagnostics.length,
      messagesPreserved: messageCount,
      memoryRecords: sealed.memory.length,
      baseIndex: diagnostics[0]!.baseIndex,
    };
  }

  const first10 = average(promptChars.slice(0, 10));
  const last10 = average(promptChars.slice(-10));
  const journal = finalBeforeEpoch.journal!;
  const engineEvents = journal.baseIndex + journal.events.length;
  const windows = [0, 10, 20].map((start) => {
    const values = dispatchMsByDay.slice(start, start + 10).flat();
    return {
      days: `${start + 1}-${start + 10}`,
      events: values.length,
      averageMs: average(values),
      maxMs: Math.max(...values),
    };
  });

  assert.equal(violations.length, 0, violations.join("\n"));
  assert(engineEvents >= 300, `engine events ${engineEvents} < 300`);
  assert(llmCalls >= 100, `LLM calls ${llmCalls} < 100`);
  assert.equal(promptChars.length, 60, "two free chats per day");
  assert(last10 <= first10 * 1.3, `prompt flatness ${last10}/${first10}`);
  assert(sortieStarts >= 30, `sortie starts ${sortieStarts} < 30`);

  return {
    label,
    card: { path: cardPath, name: parsed.name, projectId: profile.project.projectId },
    days: 30,
    engineEvents,
    measuredDispatches,
    llmCalls,
    sorties: { started: sortieStarts, completed: sortieCompletions },
    desync: { count: 0, roundTrips },
    prompt: {
      samples: promptChars,
      first10Average: first10,
      last10Average: last10,
      ratio: last10 / first10,
      limit: 1.3,
    },
    invariants: { violations },
    performance: { totalMs, tenDayWindows: windows },
    epoch,
    finalStateHash,
  };
}

const first = await run("primary", true);
const second = await run("same-seed-rerun", false);
assert.equal(second.finalStateHash, first.finalStateHash, "same-seed final state hash");
console.log(
  JSON.stringify(
    {
      ...first,
      determinism: {
        rerunHash: second.finalStateHash,
        matches: true,
        rerunEngineEvents: second.engineEvents,
        rerunLlmCalls: second.llmCalls,
      },
    },
    null,
    2,
  ),
);
