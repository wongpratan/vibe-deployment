import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StreamEvent } from "./service.js";
import type { ToolContext } from "../tools/types.js";

type StreamChunk = {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
};

type CompletionCall = (args: unknown) => AsyncIterable<StreamChunk>;

const createMock = vi.fn();
const dispatchMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: class FakeOpenAI {
      chat = {
        completions: {
          create: (args: unknown) => createMock(args),
        },
      };
    },
  };
});

vi.mock("../tools/index.js", () => ({
  getToolsForAgent: vi.fn(async () => ({
    schemas: [],
    dispatch: (name: string, args: string, ctx: ToolContext) => dispatchMock(name, args, ctx),
  })),
}));

function chunks(seq: StreamChunk[]): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of seq) yield c;
    },
  };
}

function queueResponses(responses: StreamChunk[][]) {
  createMock.mockReset();
  for (const r of responses) {
    createMock.mockImplementationOnce(async () => chunks(r));
  }
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const ctx: ToolContext = { userId: "u1", chatId: "c1" } as unknown as ToolContext;

beforeEach(() => {
  createMock.mockReset();
  dispatchMock.mockReset();
});

describe("runChat — text-only response", () => {
  it("yields text deltas and a done event with the assistant message appended", async () => {
    const { runChat } = await import("./service.js");
    queueResponses([
      [
        { choices: [{ delta: { content: "Hel" } }] },
        { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] },
      ],
    ]);

    const events = await collect(runChat([{ role: "user", content: "hi" }], ctx, "reviewer"));

    expect(events.filter((e) => e.type === "text")).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
    const done = events.find((e) => e.type === "done") as Extract<StreamEvent, { type: "done" }>;
    expect(done.messages.at(-1)).toEqual({ role: "assistant", content: "Hello" });
  });
});

describe("runChat — tool call iteration", () => {
  it("dispatches a tool call, appends the tool message, then completes after next text response", async () => {
    const { runChat } = await import("./service.js");
    queueResponses([
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call-1", function: { name: "detect_build_pack", arguments: "{\"x\":1}" } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
      [
        { choices: [{ delta: { content: "done" }, finish_reason: "stop" }] },
      ],
    ]);
    dispatchMock.mockResolvedValueOnce('{"buildPack":"dockerfile"}');

    const events = await collect(runChat([], ctx, "reviewer"));

    expect(dispatchMock).toHaveBeenCalledWith("detect_build_pack", "{\"x\":1}", ctx);
    expect(events).toContainEqual({ type: "tool_call", name: "detect_build_pack", args: "{\"x\":1}" });
    expect(events).toContainEqual({
      type: "tool_result",
      name: "detect_build_pack",
      result: '{"buildPack":"dockerfile"}',
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("bails out and emits done when finish_reason is not tool_calls after a tool call", async () => {
    const { runChat } = await import("./service.js");
    queueResponses([
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call-1", function: { name: "detect_build_pack", arguments: "{}" } },
                ],
              },
              finish_reason: "stop",
            },
          ],
        },
      ],
    ]);
    dispatchMock.mockResolvedValueOnce("{}");

    const events = await collect(runChat([], ctx, "reviewer"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
});

describe("runChat — request_user_input", () => {
  it("emits input_request and stops without dispatching", async () => {
    const { runChat } = await import("./service.js");
    queueResponses([
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-9",
                    function: {
                      name: "request_user_input",
                      arguments: JSON.stringify({
                        inputType: "text",
                        label: "Name?",
                        fieldName: "name",
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ],
    ]);

    const events = await collect(runChat([], ctx, "coordinator"));

    expect(dispatchMock).not.toHaveBeenCalled();
    const req = events.find((e) => e.type === "input_request") as Extract<
      StreamEvent,
      { type: "input_request" }
    >;
    expect(req).toMatchObject({
      inputType: "text",
      label: "Name?",
      fieldName: "name",
      toolCallId: "call-9",
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
});

describe("runChat — iteration cap", () => {
  it("emits an error after MAX_TOOL_ITERATIONS tool-only turns", async () => {
    const { runChat } = await import("./service.js");
    const toolTurn: StreamChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "c", function: { name: "detect_build_pack", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    queueResponses(Array.from({ length: 20 }, () => [toolTurn]));
    dispatchMock.mockResolvedValue("{}");

    const events = await collect(runChat([], ctx, "reviewer"));

    expect(events.at(-1)).toEqual({
      type: "error",
      message: "exceeded 20 tool iterations",
    });
  });
});
