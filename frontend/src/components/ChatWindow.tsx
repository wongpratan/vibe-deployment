"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, LogOut, Menu, Trash2, User, X } from "lucide-react";
import DynamicInput, { type InputRequest } from "./DynamicInput";

type Msg =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool"; name: string; content: string };

type AppItem = { id: string; title: string; createdAt: string; appName?: string | null };

const INITIAL_GREETING: Msg = {
  role: "assistant",
  content:
    `Hi! I'll help you define your application's deployment requirements.
To get started, what's the name of your app?`,
};

const INITIAL_INPUT: InputRequest = {
  inputType: "text",
  label: "What's the app name?",
  fieldName: "application name",
  placeholder: "my-app",
  required: true,
  toolCallId: "",
};

export default function ChatWindow() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([INITIAL_GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    { phase: "saving" | "saved" | "error"; detail?: string } | null
  >(null);
  const SAVE_TOOL = "save_deployment_requirements";
  const [pendingInput, setPendingInput] = useState<InputRequest | null>(INITIAL_INPUT);
  const chatIdRef = useRef<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  async function refreshApps() {
    const res = await fetch("/api/chats");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as AppItem[];
    setApps(data.slice().reverse());
  }

  useEffect(() => {
    refreshApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetToNew() {
    chatIdRef.current = null;
    setActiveChatId(null);
    setMessages([INITIAL_GREETING]);
    setPendingInput(INITIAL_INPUT);
    setBusy(false);
    setSaveStatus(null);
  }

  async function loadChat(id: string) {
    if (busy) return;
    const res = await fetch(`/api/chats/${id}/messages`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) return;
    const rows = (await res.json()) as Array<{
      role: string;
      content: string;
      toolCalls: unknown;
    }>;
    const mapped: Msg[] = [];
    for (const r of rows) {
      if (r.role === "tool") continue;
      if (r.role === "assistant" && !r.content) continue;
      if (r.role === "user" || r.role === "assistant") {
        mapped.push({ role: r.role, content: r.content });
      }
    }
    chatIdRef.current = id;
    setActiveChatId(id);
    setMessages(mapped.length ? mapped : [INITIAL_GREETING]);
    setPendingInput(null);
    setBusy(false);
    setSaveStatus(null);
  }

  async function deleteApp(id: string) {
    if (!confirm("Delete this application?")) return;
    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) return;
    setApps((a) => a.filter((x) => x.id !== id));
    if (id === activeChatId) resetToNew();
  }

  async function sendWithValue(text: string, fieldName?: string, label?: string) {
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusy(true);

    const payloadMessage = fieldName
      ? `My ${fieldName} is "${text}".`
      : label
      ? `Answer to "${label}": ${text}`
      : text;

    const wasNewChat = chatIdRef.current === null;

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: payloadMessage,
        ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
      }),
    });

    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok || !res.body) {
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content: `error: ${res.status}` }]);
      setBusy(false);
      return;
    }

    const cid = res.headers.get("X-Chat-Id");
    if (cid) {
      chatIdRef.current = cid;
      setActiveChatId(cid);
    }
    if (wasNewChat) refreshApps();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.replace(/^data: /, "").trim();
        if (!line) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "text") {
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, content: last.content + ev.delta }];
          });
        } else if (ev.type === "tool_call") {
          if (ev.name === SAVE_TOOL) {
            setSaveStatus({ phase: "saving" });
          } else {
            setMessages((m) => [...m, { role: "tool", name: ev.name, content: `→ ${ev.args}` }, { role: "assistant", content: "" }]);
          }
        } else if (ev.type === "tool_result") {
          if (ev.name === SAVE_TOOL) {
            let parsed: any = null;
            try { parsed = JSON.parse(ev.result); } catch {}
            if (parsed?.status === "saved") {
              setSaveStatus({ phase: "saved" });
              setTimeout(() => setSaveStatus(null), 4000);
              refreshApps();
            } else {
              setSaveStatus({ phase: "error", detail: parsed?.error ?? ev.result });
            }
          } else {
            setMessages((m) => [...m, { role: "tool", name: ev.name, content: ev.result }]);
          }
        } else if (ev.type === "input_request") {
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && !last.content) {
              return [...m.slice(0, -1), { ...last, content: ev.label }];
            }
            if (last?.role !== "assistant") {
              return [...m, { role: "assistant", content: ev.label }];
            }
            return m;
          });
          setPendingInput({
            inputType: ev.inputType,
            label: ev.label,
            fieldName: ev.fieldName,
            placeholder: ev.placeholder,
            options: ev.options,
            required: ev.required,
            toolCallId: ev.toolCallId,
          });
          setBusy(false);
        } else if (ev.type === "error") {
          setMessages((m) => [...m, { role: "assistant", content: `error: ${ev.message}` }]);
        }
      }
    }
    setBusy(false);
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendWithValue(text);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  const toastClass = saveStatus
    ? `toast ${
        saveStatus.phase === "saving"
          ? "is-saving"
          : saveStatus.phase === "saved"
          ? "is-saved"
          : "is-error"
      }`
    : "";

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <strong className="sidebar-title">Applications</strong>
            <button onClick={resetToNew} title="New application" className="btn-icon btn-icon-sm">
              + New
            </button>
          </div>
          <div className="sidebar-list">
            {apps.length === 0 ? (
              <div className="sidebar-empty">No applications yet</div>
            ) : (
              apps.map((a) => {
                const active = a.id === activeChatId;
                return (
                  <div key={a.id} className={`app-row${active ? " is-active" : ""}`}>
                    <button
                      onClick={() => loadChat(a.id)}
                      className="app-row-button"
                      title={a.appName || a.title}
                    >
                      {a.appName || a.title || "Untitled"}
                    </button>
                    <button
                      onClick={() => deleteApp(a.id)}
                      title="Delete application"
                      className="btn-icon btn-icon-danger"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      <div className="main-col">
        {saveStatus && (
          <div className={toastClass}>
            {saveStatus.phase === "saving" && (
              <>
                <span className="save-spinner" />
                <span>Saving deployment requirements…</span>
              </>
            )}
            {saveStatus.phase === "saved" && (
              <>
                <Check size={16} strokeWidth={3} />
                <span>Deployment saved</span>
              </>
            )}
            {saveStatus.phase === "error" && (
              <>
                <X size={16} strokeWidth={3} />
                <span>{saveStatus.detail ?? "Save failed"}</span>
                <button
                  onClick={() => setSaveStatus(null)}
                  className="btn-toast-dismiss"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </>
            )}
          </div>
        )}

        <header className="app-header">
          <div className="app-header-left">
            <button onClick={() => setSidebarOpen((v) => !v)} title="Toggle applications" className="btn-icon">
              <Menu size={16} strokeWidth={2} />
            </button>
            <strong>Global Page Nexus</strong>
          </div>
          <button onClick={logout} title="Logout" className="btn-icon">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="content-stream">
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            if (m.role === "assistant" && !m.content && !(busy && isLast)) return null;
            const bubbleClass =
              m.role === "user"
                ? "bubble bubble-user"
                : m.role === "tool"
                ? "bubble bubble-tool"
                : "bubble bubble-assistant";
            return (
              <div key={i} className={bubbleClass}>
                <div className="bubble-meta">
                  {m.role === "assistant" ? (
                    <>
                      <Bot size={14} strokeWidth={2} aria-label="AI" />
                      <span>Assistance</span>
                    </>
                  ) : m.role === "tool" ? (
                    `tool: ${(m as any).name}`
                  ) : (
                    <>
                      <User size={14} strokeWidth={2} aria-label="User" />
                      <span>User</span>
                    </>
                  )}
                </div>
                <div className="bubble-body">
                  {m.content}
                  {busy && i === messages.length - 1 && m.role === "assistant" && (
                    <span className="blink-cursor">▍</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pendingInput ? (
          <div className="content-narrow">
            <DynamicInput
              request={pendingInput}
              disabled={busy}
              onSubmit={(value) => {
                const { label, fieldName } = pendingInput;
                setPendingInput(null);
                sendWithValue(value, fieldName, label);
              }}
            />
          </div>
        ) : (
          <div className="composer">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask anything..."
              disabled={busy}
              className="input input-plain"
            />
            <button onClick={send} disabled={busy} className="btn btn-primary">
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
