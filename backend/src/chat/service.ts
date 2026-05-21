import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import { env } from "../env.js";
import { toolSchemas, dispatchTool } from "../tools/index.js";
import type { ToolContext } from "../tools/deployment.js";
import type { InputRequestParams, EnvVarSpec } from "./inputRequest.js";

const client = new OpenAI({
  baseURL: env.OPENAI_BASE_URL,
  apiKey: env.OPENAI_API_KEY,
});

const MAX_TOOL_ITERATIONS = 20;

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; result: string }
  | { type: "input_request"; inputType: string; label: string; fieldName?: string; placeholder?: string; defaultValue?: string; options?: string[]; required?: boolean; envVarSpec?: EnvVarSpec[]; toolCallId: string }
  | { type: "done"; messages: ChatCompletionMessageParam[] }
  | { type: "error"; message: string };

export async function* runChat(
  history: ChatCompletionMessageParam[],
  ctx: ToolContext
): AsyncGenerator<StreamEvent> {
  const messages = [...history];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = await client.chat.completions.create({
      model: env.MODEL,
      messages,
      tools: toolSchemas,
      stream: true,
    });

    let assistantContent = "";
    const toolCallAcc: Record<number, { id: string; name: string; args: string }> = {};
    let finishReason: string | null = null;

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

      if (choice.finish_reason) finishReason = choice.finish_reason;
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
          defaultValue: params.defaultValue,
          options: params.options,
          required: params.required,
          envVarSpec: params.envVarSpec,
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

    if (finishReason !== "tool_calls") {
      // model stopped for another reason after emitting tool calls — bail
      yield { type: "done", messages };
      return;
    }
  }

  yield { type: "error", message: `exceeded ${MAX_TOOL_ITERATIONS} tool iterations` };
}
