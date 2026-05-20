import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import { env } from "../env.js";
import { loadToolSchemas, dispatchTool, type ToolContext } from "../tools/index.js";
import type { InputRequestParams } from "./inputRequest.js";

const client = new OpenAI({
  baseURL: env.OPENAI_BASE_URL,
  apiKey: env.OPENAI_API_KEY,
});

const MAX_TOOL_ITERATIONS = 5;

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; result: string }
  | { type: "input_request"; inputType: string; label: string; fieldName?: string; placeholder?: string; options?: string[]; required?: boolean; toolCallId: string }
  | { type: "done"; messages: ChatCompletionMessageParam[] }
  | { type: "error"; message: string };

export async function* runChat(
  history: ChatCompletionMessageParam[],
  ctx: ToolContext
): AsyncGenerator<StreamEvent> {
  const messages = [...history];
  const tools = await loadToolSchemas();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = await client.chat.completions.create({
      model: env.MODEL,
      messages,
      tools,
      stream: true,
    });

    let assistantContent = "";
    const toolCallAcc: Record<number, { id: string; name: string; args: string }> = {};

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;

      if (delta.content) {
        assistantContent += delta.content;
        yield { type: "text", delta: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallAcc[idx]) toolCallAcc[idx] = { id: "", name: "", args: "" };
          if (tc.id) toolCallAcc[idx].id = tc.id;
          if (tc.function?.name) toolCallAcc[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallAcc[idx].args += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallAcc);

    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content: assistantContent });
      yield { type: "done", messages };
      return;
    }

    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls.map<ChatCompletionMessageToolCall>((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    };
    messages.push(assistantMsg);

    for (const tc of toolCalls) {
      if (tc.name === "request_user_input") {
        const params = JSON.parse(tc.args) as InputRequestParams;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ status: "awaiting_user_input" }),
        });
        yield {
          type: "input_request",
          inputType: params.inputType,
          label: params.label,
          fieldName: params.fieldName,
          placeholder: params.placeholder,
          options: params.options,
          required: params.required,
          toolCallId: tc.id,
        };
        yield { type: "done", messages };
        return;
      }
      yield { type: "tool_call", name: tc.name, args: tc.args };
      const result = await dispatchTool(tc.name, tc.args, ctx);
      yield { type: "tool_result", name: tc.name, result };
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  yield { type: "error", message: `exceeded ${MAX_TOOL_ITERATIONS} tool iterations` };
}
