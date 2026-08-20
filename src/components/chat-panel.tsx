"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useState } from "react";

const SUGGESTIONS = [
  "What makes an application agentic, and why does it need tracing?",
  "What is (1024 * 7) / 3, rounded to two decimals?",
  "What time is it in Asia/Kolkata right now?",
];

type ChatPanelProps = {
  conversationId: string;
  initialMessages: UIMessage[];
  onTurnComplete: () => void;
};

export function ChatPanel({
  conversationId,
  initialMessages,
  onTurnComplete,
}: ChatPanelProps) {
  const [input, setInput] = useState("");

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
          message: allMessages[allMessages.length - 1],
        },
      }),
    }),
    onFinish: onTurnComplete,
  });

  const isBusy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  return (
    <>
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            Ask something that needs a tool:
            <ul>
              {SUGGESTIONS.map((suggestion) => (
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
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the agent something…"
          aria-label="Message"
        />
        {isBusy ? (
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={input.trim().length === 0}>
            Send
          </button>
        )}
      </form>
    </>
  );
}
