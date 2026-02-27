import type { UIMessage } from "ai";

export type ChatToolInvocation = {
  toolCallId: string;
  toolName: string;
  state: "call" | "result";
  args?: Record<string, unknown>;
  result?: unknown;
};

export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  toolInvocations?: ChatToolInvocation[];
};

export function uiMessageToChatMessage(message: UIMessage): ChatMessage {
  const textParts = message.parts.filter((part) => part.type === "text") as Array<{
    type: "text";
    text: string;
  }>;

  const toolInvocations: ChatToolInvocation[] = message.parts
    .filter((part) => part.type.startsWith("tool-") || part.type === "dynamic-tool")
    .map((part) => {
      const p = part as {
        type: string;
        toolCallId: string;
        toolName?: string;
        state: string;
        input?: unknown;
        output?: unknown;
        errorText?: string;
      };

      const toolName = p.type === "dynamic-tool" ? p.toolName ?? "unknown" : p.type.replace("tool-", "");
      const isResult = p.state === "output-available" || p.state === "output-error" || p.state === "output-denied";

      return {
        toolCallId: p.toolCallId,
        toolName,
        state: isResult ? "result" : "call",
        args: (p.input as Record<string, unknown> | undefined) ?? {},
        result:
          p.state === "output-error"
            ? { error: p.errorText ?? "Tool failed" }
            : p.state === "output-denied"
              ? { error: "Tool output denied" }
              : p.output,
      };
    });

  return {
    id: message.id,
    role: message.role,
    content: textParts.map((part) => part.text).join("\n"),
    toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
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
