import { describe, expect, it } from "vitest";
import { defaultCardPreset } from "@simbot/risu";
import { ProjectRuntime } from "@simbot/runtime";
import { PlaySession } from "../src/index.ts";

function makeSession() {
  return new PlaySession({
    id: "message-window",
    runtime: new ProjectRuntime({
      projectId: "message-window",
      schema: { initialState: {} },
      screens: [],
      navigation: [],
      content: {},
      featureToggles: {},
      moduleIds: [],
    }),
    preset: defaultCardPreset(),
    card: { name: "Window" },
    provider: { async complete() { return { text: "answer" }; } },
  });
}

describe("bounded message access", () => {
  it("reads only the requested rows without exposing mutable session messages", async () => {
    const session = makeSession();
    await session.send("one");
    await session.send("two");

    expect(session.messageCount).toBe(4);
    expect(session.messageRange(1, 2).map((message) => message.content)).toEqual(["answer", "two"]);
    expect(session.messageRange(-10, 1).map((message) => message.content)).toEqual(["one"]);
    expect(session.messageRange(99, 10)).toEqual([]);
    expect(session.messageAt(-1)).toBeNull();

    const copy = session.messageAt(0)!;
    copy.content = "mutated outside";
    expect(session.messageAt(0)?.content).toBe("one");
  });

  it("caches a light outline until the actual message list changes", async () => {
    const session = makeSession();
    const empty = session.messageOutline;
    expect(session.messageOutline).toBe(empty);
    expect(Object.isFrozen(empty)).toBe(true);

    const before = session.messageRevision;
    await session.send("one");
    const first = session.messageOutline;
    expect(session.messageRevision).toBeGreaterThan(before);
    expect(first).toEqual([
      { id: "m1", index: 0, role: "user", origin: "user" },
      { id: "m2", index: 1, role: "assistant", origin: "model" },
    ]);
    expect(session.messageOutline).toBe(first);

    await session.editMessage("m2", "edited");
    expect(session.messageOutline).not.toBe(first);
    expect(session.messageAt(1)?.content).toBe("edited");
    await session.removeMessage("m1");
    expect(session.messageOutline).toEqual([
      { id: "m2", index: 0, role: "assistant", origin: "model" },
    ]);
  });
});
