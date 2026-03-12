import type { UIMessage } from "ai";

const extractReasoningTexts = (value: unknown): string[] => {
  const texts: string[] = [];

  const visit = (node: unknown) => {
    if (!node) return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : undefined;
    const text = typeof record.text === "string" ? record.text : undefined;

    if ((type === "reasoning" || type === "reasoning.text" || type === "reasoning-text" || type === "reasoning_text") && text) {
      texts.push(text);
    }

    if (record.providerOptions) visit(record.providerOptions);
    if (record.openrouter) visit(record.openrouter);
    if (record.reasoning_details) visit(record.reasoning_details);
    if (record.content) visit(record.content);
    if (record.output) visit(record.output);
    if (record.input) visit(record.input);
    if (record.parts) visit(record.parts);
  };

  visit(value);

  return texts;
};

export type ChatToolInvocation = {
  toolCallId: string;
  toolName: string;
  state: "call" | "result";
  rawType: string;
  rawState: string;
  args?: Record<string, unknown>;
  result?: unknown;
  errorText?: string;
  reasoning?: string;
};

export type ChatMessagePart =
  | {
      id: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      type: "reasoning";
      text: string;
    }
  | {
      id: string;
      type: "tool";
      toolInvocation: ChatToolInvocation;
    };

export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
  toolInvocations?: ChatToolInvocation[];
  parts?: ChatMessagePart[];
};

const toToolInvocation = (part: {
  type: string;
  toolCallId: string;
  toolName?: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  providerOptions?: unknown;
}): ChatToolInvocation => {
  const toolName = part.type === "dynamic-tool" ? part.toolName ?? "unknown" : part.type.replace("tool-", "");
  const isResult = part.state === "output-available" || part.state === "output-error" || part.state === "output-denied";
  const result =
    part.state === "output-error"
      ? { error: part.errorText ?? "Tool failed" }
      : part.state === "output-denied"
        ? { error: "Tool output denied" }
        : part.output;

  return {
    toolCallId: part.toolCallId,
    toolName,
    state: isResult ? "result" : "call",
    rawType: part.type,
    rawState: part.state,
    args: (part.input as Record<string, unknown> | undefined) ?? {},
    result,
    errorText: part.errorText,
    reasoning: extractReasoningTexts(part).join("\n"),
  };
};

export function uiMessageToChatMessage(message: UIMessage): ChatMessage {
  const parts: ChatMessagePart[] = [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolInvocations: ChatToolInvocation[] = [];

  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text) return;

      textParts.push(text);
      parts.push({
        id: `${message.id}-text-${index}`,
        type: "text",
        text,
      });
      return;
    }

    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      const toolInvocation = toToolInvocation(part as {
        type: string;
        toolCallId: string;
        toolName?: string;
        state: string;
        input?: unknown;
        output?: unknown;
        errorText?: string;
        providerOptions?: unknown;
      });

      toolInvocations.push(toolInvocation);
      parts.push({
        id: `${message.id}-tool-${toolInvocation.toolCallId}`,
        type: "tool",
        toolInvocation,
      });
      return;
    }

    const extractedReasoningParts = extractReasoningTexts(part);
    extractedReasoningParts.forEach((text, reasoningIndex) => {
      reasoningParts.push(text);
      parts.push({
        id: `${message.id}-reasoning-${index}-${reasoningIndex}`,
        type: "reasoning",
        text,
      });
    });
  });

  return {
    id: message.id,
    role: message.role,
    content: textParts.join("\n"),
    reasoning: reasoningParts.join("\n"),
    toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
    parts: parts.length > 0 ? parts : undefined,
  };
}

export function uiMessagesToChatMessages(messages: UIMessage[]): ChatMessage[] {
  return messages.map(uiMessageToChatMessage);
}

export function chatMessageToUIMessage(message: ChatMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.content
      ? [{ type: "text", text: message.content }]
      : [],
  };
}

export function chatMessagesToUIMessages(messages: ChatMessage[]): UIMessage[] {
  return messages.map(chatMessageToUIMessage);
}
