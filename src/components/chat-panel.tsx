"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useRef, useState } from "react";

import type { AgentSummary } from "@/agents/types";

/** Keeps attachments well under the request body limit; they are stored too. */
const MAX_FILES = 4;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const SUGGESTIONS: Record<string, string[]> = {
  general: [
    "What changed in the EU AI Act this year?",
    "Compare the pricing of the major LLM providers right now.",
  ],
  research: [
    "How do current agent benchmarks actually measure tool use? Compare a few.",
    "What is the state of the evidence on RAG versus long context?",
  ],
  analyst: [
    "Simulate 10,000 rounds of the Monty Hall problem and report the win rates.",
    "Fit a linear regression to this data and tell me if the trend is significant.",
  ],
  local: [
    "What makes an application agentic, and why does it need tracing?",
    "What is (1024 * 7) / 3, rounded to two decimals?",
  ],
};

type ChatPanelProps = {
  conversationId: string;
  agentId: string;
  agent: AgentSummary | undefined;
  initialMessages: UIMessage[];
  onTurnComplete: () => void;
};

export function ChatPanel({
  conversationId,
  agentId,
  agent,
  initialMessages,
  onTurnComplete,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<FileList | undefined>();
  const [attachmentError, setAttachmentError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, stop, error } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // History is stored server-side, so only the newest message goes over
      // the wire. Payload size then stays constant as a thread grows.
      prepareSendMessagesRequest: ({ messages: allMessages }) => ({
        body: {
          conversationId,
          agentId,
          message: allMessages[allMessages.length - 1],
        },
      }),
    }),
    onFinish: onTurnComplete,
  });

  const isBusy = status === "submitted" || status === "streaming";

  function clearAttachments() {
    setFiles(undefined);
    setAttachmentError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function selectFiles(selected: FileList | null) {
    if (!selected || selected.length === 0) return clearAttachments();

    const total = [...selected].reduce((sum, file) => sum + file.size, 0);
    if (selected.length > MAX_FILES) {
      setAttachmentError(`At most ${MAX_FILES} files.`);
      return;
    }
    if (total > MAX_TOTAL_BYTES) {
      setAttachmentError("Attachments must total under 8 MB.");
      return;
    }

    setAttachmentError(undefined);
    setFiles(selected);
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !files) || isBusy || attachmentError) return;

    setInput("");
    void sendMessage(files ? { text: trimmed, files } : { text: trimmed });
    clearAttachments();
  }

  const suggestions = SUGGESTIONS[agentId] ?? [];

  return (
    <>
      <div className="messages">
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="empty">
            Try asking {agent?.name ?? "this agent"}:
            <ul>
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onClick={() => submit(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <span className="role">{message.role}</span>
            {message.parts.map((part, index) => {
              const key = `${message.id}-${index}`;

              if (part.type === "text") {
                return (
                  <div key={key} className="bubble">
                    {part.text}
                  </div>
                );
              }

              if (part.type === "reasoning" && part.text.length > 0) {
                return (
                  <div key={key} className="reasoning">
                    {part.text}
                  </div>
                );
              }

              if (part.type === "file") {
                return (
                  <div key={key} className="attachment">
                    {part.filename ?? part.mediaType}
                  </div>
                );
              }

              // Citations produced by the web search and fetch tools.
              if (part.type === "source-url") {
                return (
                  <a
                    key={key}
                    className="source"
                    href={part.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {part.title ?? part.url}
                  </a>
                );
              }

              if (isToolUIPart(part)) {
                return (
                  <details key={key} className="tool">
                    <summary>
                      {getToolName(part)}
                      {part.state === "output-available" ? "" : " …"}
                    </summary>
                    <pre>{JSON.stringify(part.input, null, 2)}</pre>
                    {part.state === "output-available" && (
                      <pre>{JSON.stringify(part.output, null, 2)}</pre>
                    )}
                    {part.state === "output-error" && (
                      <pre className="error">{part.errorText}</pre>
                    )}
                  </details>
                );
              }

              return null;
            })}
          </div>
        ))}

        {error && <p className="error">{error.message}</p>}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        <label className="attach" title="Attach images or PDFs">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,text/plain"
            onChange={(event) => selectFiles(event.target.files)}
          />
          <span aria-hidden="true">＋</span>
          <span className="visually-hidden">Attach files</span>
        </label>

        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={`Ask ${agent?.name ?? "the agent"} something…`}
          aria-label="Message"
        />

        {isBusy ? (
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={
              (input.trim().length === 0 && !files) || Boolean(attachmentError)
            }
          >
            Send
          </button>
        )}
      </form>

      {(files || attachmentError) && (
        <p className={attachmentError ? "error attachments" : "attachments"}>
          {attachmentError ??
            `${files?.length} file(s) attached`}
        </p>
      )}
    </>
  );
}
