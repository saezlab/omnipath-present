"use client";

import { ChatMessagePart, ChatToolInvocation } from "../types";
import { motion } from "framer-motion";
import { ReactNode } from "react";

import { Markdown } from "./markdown";
import { ToolResponse } from "./tool-response";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import type { ToolResult } from "./dual-mode-interface";
import {
  Message as AIMessage,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

type ExtendedToolInvocation = ChatToolInvocation;

const ToolDetails = ({
  toolInvocation,
  onToolResultClick,
  messageId,
}: {
  toolInvocation: ExtendedToolInvocation;
  onToolResultClick?: (result: ToolResult) => void;
  messageId: string;
}) => {
  const { result, args, reasoning, rawState, rawType, toolName, errorText } = toolInvocation;

  const resultRecord = result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
  const totalCount = typeof resultRecord?.totalCount === "number"
    ? resultRecord.totalCount
    : typeof resultRecord?.summary === "object" && resultRecord.summary && typeof (resultRecord.summary as Record<string, unknown>).totalInteractions === "number"
      ? Number((resultRecord.summary as Record<string, unknown>).totalInteractions)
      : undefined;

  const statusNote = errorText
    ? errorText
    : rawState === "output-denied"
      ? "Tool output was denied."
      : rawState === "output-error"
        ? "Tool execution failed."
        : rawState === "output-available" && totalCount === 0
          ? "Tool completed but returned 0 results."
          : rawState === "input-available" || rawState === "input-streaming"
            ? "Tool call is in progress."
            : undefined;

  return (
    <Tool className="w-full max-w-2xl" defaultOpen={false}>
      <ToolHeader type={rawType as never} state={rawState as never} toolName={rawType === "dynamic-tool" ? toolName : undefined} />

      {rawState === "output-available" && Boolean(result) && (
        <div className="px-3 pb-3">
          <ToolResponse toolInvocation={toolInvocation} onToolResultClick={onToolResultClick} messageId={messageId} />
        </div>
      )}

      <ToolContent>
        {args && Object.keys(args).length > 0 && <ToolInput input={args} />}

        {!!reasoning && (
          <Reasoning defaultOpen={false}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoning}</ReasoningContent>
          </Reasoning>
        )}

        {statusNote && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {statusNote}
          </div>
        )}

        {(result !== undefined || errorText) && <ToolOutput output={result} errorText={errorText} />}
      </ToolContent>
    </Tool>
  );
};

export const Message = ({
  role,
  content,
  reasoning,
  toolInvocations,
  parts,
  isInitialMessage,
  id,
  startEdit,
  onToolResultClick
}: {
  role: string;
  content: string | ReactNode;
  reasoning?: string;
  toolInvocations: Array<ChatToolInvocation> | undefined;
  parts?: ChatMessagePart[];
  isInitialMessage?: boolean;
  id: string;
  startEdit?: (messageId: string, currentContent: string) => void;
  onToolResultClick?: (result: ToolResult) => void;
}) => {
  const canEdit = role === "user" && typeof content === "string" && !!startEdit;

  const renderText = (text: string, key: string) => (
    <MessageContent
      key={key}
      className={`relative group w-full ${
        isInitialMessage && role !== "user" ? "text-lg font-medium" : ""
      }`}
    >
      <Markdown>{text}</Markdown>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => startEdit(id, content as string)}
          className="absolute top-1 right-1 h-6 w-6 text-zinc-400 dark:text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          aria-label="Edit message"
          data-edit-button="true"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </MessageContent>
  );

  const orderedParts: ChatMessagePart[] = parts && parts.length > 0
    ? parts
    : [
        ...(toolInvocations?.map((toolInvocation) => ({
          id: `${id}-tool-${toolInvocation.toolCallId}`,
          type: "tool" as const,
          toolInvocation,
        })) ?? []),
        ...((reasoning && role === "assistant")
          ? [{ id: `${id}-reasoning-fallback`, type: "reasoning" as const, text: reasoning }]
          : []),
        ...(content && typeof content === "string"
          ? [{ id: `${id}-text-fallback`, type: "text" as const, text: content }]
          : []),
      ];

  return (
    <motion.div
      className={`flex flex-row gap-4 px-4 w-full md:px-0 mb-8 ${
        role === "user" ? "justify-end" : "justify-start"
      } ${isInitialMessage ? "text-center" : ""}`}
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
    >
      <AIMessage from={role as "user" | "assistant" | "system"} className={`${role === "user" ? "w-[66%]" : "w-full"} ${isInitialMessage ? "items-center" : ""}`}>
        {orderedParts.map((part) => {
          if (part.type === "tool") {
            return (
              <ToolDetails
                key={part.id}
                toolInvocation={part.toolInvocation}
                onToolResultClick={onToolResultClick}
                messageId={id}
              />
            );
          }

          if (part.type === "reasoning" && role === "assistant" && part.text) {
            return (
              <Reasoning key={part.id} className="w-full max-w-2xl" defaultOpen={false}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          }

          if (part.type === "text" && part.text) {
            return renderText(part.text, part.id);
          }

          return null;
        })}
      </AIMessage>
    </motion.div>
  );
};
