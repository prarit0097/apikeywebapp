import { randomUUID } from "node:crypto";
export type Event = { type: string; [key: string]: any };
export class ProtocolError extends Error {}
const unsupported = (name: string) => {
  throw new ProtocolError(`Unsupported feature for this adapter: ${name}`);
};
function text(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      if (b.type !== "text") unsupported(b.type || "content block");
      if (b.cache_control) unsupported("prompt caching");
      return b.text || "";
    })
    .join("\n");
}
export function toOpenAI(input: any, model: string): any {
  const supported = new Set([
    "model",
    "messages",
    "system",
    "max_tokens",
    "stream",
    "temperature",
    "top_p",
    "top_k",
    "stop_sequences",
    "tools",
    "tool_choice",
    "metadata",
    "thinking",
    "output_config",
  ]);
  for (const k of Object.keys(input)) if (!supported.has(k)) unsupported(k);
  if (input.thinking && input.thinking.type !== "disabled")
    unsupported("thinking/reasoning");
  if (input.top_k !== undefined) unsupported("top_k");
  if (input.output_config) {
    if (
      typeof input.output_config !== "object" ||
      Object.keys(input.output_config).some((k) => k !== "effort")
    )
      unsupported("output_config");
    if (
      input.output_config.effort !== undefined &&
      !["none", "minimal", "low", "medium", "high", "xhigh"].includes(
        input.output_config.effort,
      )
    )
      unsupported("output_config.effort");
  }
  const messages: any[] = [];
  if (input.system)
    messages.push({ role: "system", content: text(input.system) });
  for (const m of input.messages) {
    if (typeof m.content === "string") {
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    const content: any[] = m.content || [];
    const tools = content.filter((b) => b.type === "tool_use"),
      results = content.filter((b) => b.type === "tool_result"),
      texts = content.filter((b) => b.type === "text");
    for (const b of content) {
      if (!["text", "tool_use", "tool_result"].includes(b.type))
        unsupported(b.type);
      if (b.cache_control) unsupported("prompt caching");
    }
    // OpenAI requires tool results immediately after the assistant tool call.
    for (const b of results)
      messages.push({
        role: "tool",
        tool_call_id: b.tool_use_id,
        content: text(b.content),
      });
    if (tools.length || texts.length)
      messages.push({
        role: m.role,
        content: texts.length ? text(texts) : null,
        ...(tools.length
          ? {
              tool_calls: tools.map((b) => ({
                id: b.id,
                type: "function",
                function: { name: b.name, arguments: JSON.stringify(b.input) },
              })),
            }
          : {}),
      });
  }
  const out: any = {
    model,
    messages,
    max_tokens: input.max_tokens || 4096,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (input.output_config?.effort !== undefined)
    out.reasoning_effort = input.output_config.effort;
  for (const k of ["temperature", "top_p"])
    if (input[k] !== undefined) out[k] = input[k];
  if (input.stop_sequences) out.stop = input.stop_sequences;
  if (input.tools?.length) {
    out.tools = input.tools.map((t: any) => {
      if (t.type || t.cache_control || t.defer_loading)
        unsupported("server tools, deferred tools or cached tools");
      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      };
    });
  }
  if (input.tool_choice) {
    const t = input.tool_choice;
    out.tool_choice =
      t.type === "tool"
        ? { type: "function", function: { name: t.name } }
        : t.type === "any"
          ? "required"
          : t.type === "none"
            ? "none"
            : "auto";
    if (t.disable_parallel_tool_use !== undefined)
      out.parallel_tool_calls = !t.disable_parallel_tool_use;
  }
  return out;
}
export function fromOpenAI(input: any): any {
  const supported = new Set([
    "model",
    "messages",
    "max_tokens",
    "max_completion_tokens",
    "stream",
    "stream_options",
    "temperature",
    "top_p",
    "stop",
    "tools",
    "tool_choice",
    "parallel_tool_calls",
    "user",
  ]);
  for (const k of Object.keys(input)) if (!supported.has(k)) unsupported(k);
  if (
    input.stream_options &&
    Object.keys(input.stream_options).some((k) => k !== "include_usage")
  )
    unsupported("stream_options");
  const out: any = {
    model: input.model,
    max_tokens: input.max_completion_tokens || input.max_tokens || 4096,
    stream: !!input.stream,
    messages: [],
  };
  const systems: string[] = [];
  for (const m of input.messages || []) {
    if (m.role === "system" || m.role === "developer") {
      systems.push(text(m.content));
      continue;
    }
    if (m.role === "tool") {
      out.messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: text(m.content),
          },
        ],
      });
      continue;
    }
    if (!["user", "assistant"].includes(m.role)) unsupported(`role ${m.role}`);
    const blocks: any[] = [];
    if (m.content) blocks.push({ type: "text", text: text(m.content) });
    for (const call of m.tool_calls || []) {
      let args;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        throw new ProtocolError("Tool arguments must be valid JSON");
      }
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: args,
      });
    }
    out.messages.push({ role: m.role, content: blocks });
  }
  if (systems.length) out.system = systems.join("\n");
  for (const k of ["temperature", "top_p"])
    if (input[k] !== undefined) out[k] = input[k];
  if (input.stop)
    out.stop_sequences = Array.isArray(input.stop) ? input.stop : [input.stop];
  if (input.tools)
    out.tools = input.tools.map((t: any) => {
      if (t.type !== "function" || t.function?.strict)
        unsupported("non-function or strict tools");
      return {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      };
    });
  if (input.tool_choice)
    out.tool_choice =
      typeof input.tool_choice === "string"
        ? { type: input.tool_choice === "required" ? "any" : input.tool_choice }
        : { type: "tool", name: input.tool_choice.function.name };
  if (input.parallel_tool_calls !== undefined)
    out.tool_choice = {
      ...(out.tool_choice || { type: "auto" }),
      disable_parallel_tool_use: !input.parallel_tool_calls,
    };
  return out;
}
export async function* readSSE(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 2 * 1024 * 1024)
      throw new ProtocolError("Upstream SSE event too large");
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, boundary);
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/)![0];
      buffer = buffer.slice(boundary + match.length);
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() && !buffer.trim().startsWith(":"))
    throw new ProtocolError("Incomplete upstream SSE event");
}
export async function* openAIEvents(
  source: AsyncIterable<{ data: string }>,
  model: string,
): AsyncGenerator<Event> {
  const id = `msg_${randomUUID().replace(/-/g, "")}`;
  yield {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  let next = 0,
    textIndex: number | undefined,
    finished = false,
    finish = "end_turn";
  const tools = new Map<number, { index: number; id: string; name: string }>();
  const started: number[] = [];
  let usage: any;
  for await (const event of source) {
    if (event.data === "[DONE]") break;
    let chunk: any;
    try {
      chunk = JSON.parse(event.data);
    } catch {
      throw new ProtocolError("Invalid upstream JSON stream");
    }
    if (chunk.error)
      throw new ProtocolError("Upstream returned a stream error");
    if (chunk.usage) usage = chunk.usage;
    const c = chunk.choices?.[0];
    if (!c) continue;
    const delta = c.delta || {};
    if (delta.reasoning_content || delta.reasoning)
      unsupported("upstream reasoning stream");
    if (delta.content) {
      if (textIndex === undefined) {
        textIndex = next++;
        started.push(textIndex);
        yield {
          type: "content_block_start",
          index: textIndex,
          content_block: { type: "text", text: "" },
        };
      }
      yield {
        type: "content_block_delta",
        index: textIndex,
        delta: { type: "text_delta", text: delta.content },
      };
    }
    for (const t of delta.tool_calls || []) {
      let tool = tools.get(t.index);
      if (!tool) {
        if (!t.id || !t.function?.name)
          throw new ProtocolError("Upstream tool start is missing ID or name");
        tool = { index: next++, id: t.id, name: t.function.name };
        tools.set(t.index, tool);
        started.push(tool.index);
        yield {
          type: "content_block_start",
          index: tool.index,
          content_block: {
            type: "tool_use",
            id: tool.id,
            name: tool.name,
            input: {},
          },
        };
      }
      if (t.function?.arguments)
        yield {
          type: "content_block_delta",
          index: tool.index,
          delta: {
            type: "input_json_delta",
            partial_json: t.function.arguments,
          },
        };
    }
    if (c.finish_reason) {
      finished = true;
      finish =
        c.finish_reason === "tool_calls"
          ? "tool_use"
          : c.finish_reason === "length"
            ? "max_tokens"
            : c.finish_reason === "content_filter"
              ? "refusal"
              : "end_turn";
    }
  }
  if (!finished)
    throw new ProtocolError(
      "Incomplete upstream stream: missing finish reason",
    );
  for (const index of started) yield { type: "content_block_stop", index };
  const realUsage =
    Number.isFinite(usage?.prompt_tokens) &&
    Number.isFinite(usage?.completion_tokens)
      ? {
          input_tokens: Math.max(0, usage.prompt_tokens),
          output_tokens: Math.max(0, usage.completion_tokens),
        }
      : undefined;
  yield {
    type: "message_delta",
    delta: { stop_reason: finish, stop_sequence: null },
    ...(realUsage ? { usage: realUsage } : {}),
  };
  yield { type: "message_stop" };
}
export async function collectMessage(
  events: AsyncIterable<Event>,
): Promise<any> {
  let result: any;
  const args = new Map<number, string>();
  let complete = false;
  let known = false;
  for await (const e of events) {
    if (e.type === "message_start") {
      result = { ...e.message, content: [] };
      if (e.message.usage?.input_tokens !== undefined)
        result.usage = { ...e.message.usage };
    }
    if (e.type === "content_block_start") {
      result.content[e.index] = { ...e.content_block };
      if (e.content_block.type === "tool_use") args.set(e.index, "");
    }
    if (e.type === "content_block_delta") {
      const b = result?.content[e.index];
      if (!b) throw new ProtocolError("Invalid content block sequence");
      if (e.delta.type === "text_delta") b.text += e.delta.text;
      if (e.delta.type === "thinking_delta")
        b.thinking = (b.thinking || "") + e.delta.thinking;
      if (e.delta.type === "signature_delta")
        b.signature = (b.signature || "") + e.delta.signature;
      if (e.delta.type === "citations_delta")
        b.citations = [...(b.citations || []), e.delta.citation];
      if (
        ![
          "text_delta",
          "thinking_delta",
          "signature_delta",
          "citations_delta",
          "input_json_delta",
        ].includes(e.delta.type)
      )
        throw new ProtocolError(
          `Unsupported native content delta: ${e.delta.type}`,
        );
      if (e.delta.type === "input_json_delta")
        args.set(e.index, (args.get(e.index) || "") + e.delta.partial_json);
    }
    if (e.type === "content_block_stop" && args.has(e.index)) {
      try {
        result.content[e.index].input = JSON.parse(args.get(e.index) || "{}");
      } catch {
        throw new ProtocolError("Incomplete tool JSON");
      }
    }
    if (e.type === "message_delta") {
      Object.assign(result, e.delta);
      if (e.usage) {
        known = true;
        result.usage = { ...result.usage, ...e.usage };
      }
    }
    if (e.type === "error") throw new ProtocolError("Upstream stream error");
    if (e.type === "message_stop") complete = true;
  }
  if (!result || !complete)
    throw new ProtocolError("Incomplete upstream message");
  if (!known) result.usage = { input_tokens: null, output_tokens: null };
  return result;
}
export function messageToOpenAI(m: any) {
  return {
    id: m.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: m.model,
    choices: [
      {
        index: 0,
        finish_reason:
          m.stop_reason === "tool_use"
            ? "tool_calls"
            : m.stop_reason === "max_tokens"
              ? "length"
              : "stop",
        message: {
          role: "assistant",
          content:
            m.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("") || null,
          ...(m.content.some((b: any) => b.type === "tool_use")
            ? {
                tool_calls: m.content
                  .filter((b: any) => b.type === "tool_use")
                  .map((b: any) => ({
                    id: b.id,
                    type: "function",
                    function: {
                      name: b.name,
                      arguments: JSON.stringify(b.input),
                    },
                  })),
              }
            : {}),
        },
      },
    ],
    ...(m.usage?.input_tokens !== null && m.usage?.output_tokens !== null
      ? {
          usage: {
            prompt_tokens: m.usage.input_tokens,
            completion_tokens: m.usage.output_tokens,
            total_tokens: m.usage.input_tokens + m.usage.output_tokens,
          },
        }
      : {}),
  };
}
