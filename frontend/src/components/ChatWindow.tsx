"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, ClipboardCheck, LogOut, Menu, Network, RefreshCcw, Rocket, Trash2, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DynamicInput, { type InputRequest } from "./DynamicInput";
import {
  coordinatorAppNameInput,
  coordinatorGreeting,
  deployerGreeting,
  unwrapUserPayload,
  type Msg,
} from "@/lib/chatMessages";
import type { WireWorkflowState } from "@/lib/workflow";

type AppItem = { id: string; title: string; createdAt: string; appName: string | null };

type AgentId = "reviewer" | "coordinator" | "deployer";

const AGENTS: { id: AgentId; label: string; Icon: typeof ClipboardCheck }[] = [
  { id: "reviewer", label: "Reviewer", Icon: ClipboardCheck },
  { id: "coordinator", label: "Coordinator", Icon: Network },
  { id: "deployer", label: "Deployer", Icon: Rocket },
];

type AgentMap<T> = Record<AgentId, T>;

const REVIEWER_GREETING: Msg = {
  role: "assistant",
  content:
    `Hi! I review GitHub repos for Coolify deployment readiness.
Paste the repo URL and I'll check which Coolify build pack fits and what (if anything) is missing.`,
};

const REVIEWER_INITIAL_INPUT: InputRequest = {
  inputType: "github_url",
  label: "GitHub repo URL to review?",
  fieldName: "git repo URL",
  placeholder: "https://github.com/owner/repo.git",
  required: true,
  toolCallId: "",
};

const COORDINATOR_GREETING: Msg = coordinatorGreeting(null);

const DEPLOYER_GREETING: Msg = deployerGreeting(null);

const AGENT_INITIAL: AgentMap<{ greeting: Msg; input: InputRequest | null }> = {
  reviewer: { greeting: REVIEWER_GREETING, input: REVIEWER_INITIAL_INPUT },
  coordinator: { greeting: COORDINATOR_GREETING, input: null },
  deployer: { greeting: DEPLOYER_GREETING, input: null },
};

function initialMessages(): AgentMap<Msg[]> {
  return {
    reviewer: [AGENT_INITIAL.reviewer.greeting],
    coordinator: [AGENT_INITIAL.coordinator.greeting],
    deployer: [AGENT_INITIAL.deployer.greeting],
  };
}

function initialPendingInput(): AgentMap<InputRequest | null> {
  return {
    reviewer: AGENT_INITIAL.reviewer.input,
    coordinator: AGENT_INITIAL.coordinator.input,
    deployer: AGENT_INITIAL.deployer.input,
  };
}

function initialFlag<T>(value: T): AgentMap<T> {
  return { reviewer: value, coordinator: value, deployer: value };
}

export default function ChatWindow() {
  const router = useRouter();
  const [messagesByAgent, setMessagesByAgent] = useState<AgentMap<Msg[]>>(initialMessages);
  const [input, setInput] = useState("");
  const [busyByAgent, setBusyByAgent] = useState<AgentMap<boolean>>(() => initialFlag(false));
  const [pendingInputByAgent, setPendingInputByAgent] = useState<AgentMap<InputRequest | null>>(initialPendingInput);
  const [toolStatusByAgent, setToolStatusByAgent] = useState<AgentMap<string | null>>(() => initialFlag<string | null>(null));
  const [wireState, setWireState] = useState<WireWorkflowState | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeAgent, setActiveAgent] = useState<AgentId>("reviewer");

  const messages = messagesByAgent[activeAgent];
  const busy = busyByAgent[activeAgent];
  const pendingInput = pendingInputByAgent[activeAgent];
  const toolStatus = toolStatusByAgent[activeAgent];
  const coord = wireState?.coordinator;
  const deployer = wireState?.deployer;
  const reviewerReady = wireState?.reviewer.ready ?? false;
  const collected = coord?.collected ?? false;
  const isGatedCoordinator = activeAgent === "coordinator" && !(coord?.open ?? false);
  const isGatedDeployer = activeAgent === "deployer" && !(deployer?.open ?? false);
  const isGated = isGatedCoordinator || isGatedDeployer;

  function patchMessages(agent: AgentId, fn: (prev: Msg[]) => Msg[]) {
    setMessagesByAgent((s) => ({ ...s, [agent]: fn(s[agent]) }));
  }
  function setBusyFor(agent: AgentId, value: boolean) {
    setBusyByAgent((s) => ({ ...s, [agent]: value }));
  }
  function setPendingInputFor(agent: AgentId, value: InputRequest | null) {
    setPendingInputByAgent((s) => ({ ...s, [agent]: value }));
  }
  function setToolStatusFor(agent: AgentId, value: string | null) {
    setToolStatusByAgent((s) => ({ ...s, [agent]: value }));
  }
  function applyWorkflowState(s: WireWorkflowState) {
    setWireState(s);
    const nameGuess = s.reviewer.nameGuess;
    if (s.reviewer.ready) {
      setMessagesByAgent((m) => {
        const cur = m.coordinator;
        if (nameGuess && cur.length === 1 && cur[0].role === "assistant") {
          return { ...m, coordinator: [coordinatorGreeting(nameGuess)] };
        }
        return m;
      });
      setPendingInputByAgent((p) => {
        if (p.coordinator || s.coordinator.collected) return p;
        return { ...p, coordinator: coordinatorAppNameInput(nameGuess) };
      });
    }
    if (s.coordinator.collected) {
      setMessagesByAgent((m) => {
        const cur = m.deployer;
        if (cur.length === 1 && cur[0].role === "assistant") {
          const ctx = {
            collected: s.coordinator.collected,
            appName: s.coordinator.appName,
            envVarKeys: s.coordinator.envVarKeys,
            envVars: s.coordinator.envVars,
            buildPack: s.deployer.buildPack,
            targetUrl: s.deployer.targetUrl,
          };
          return { ...m, deployer: [deployerGreeting(ctx)] };
        }
        return m;
      });
    }
  }

  async function refreshWorkflowState(id: string): Promise<WireWorkflowState | null> {
    const res = await fetch(`/api/chats/${id}/state`);
    if (!res.ok) return null;
    const s = (await res.json()) as WireWorkflowState;
    applyWorkflowState(s);
    return s;
  }

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

  useEffect(() => {
    const name = coord?.appName;
    if (!name || !activeChatId) return;
    setApps((prev) =>
      prev.map((a) =>
        a.id === activeChatId && a.appName !== name ? { ...a, appName: name } : a
      )
    );
  }, [coord?.appName, activeChatId]);

  function resetToNew() {
    chatIdRef.current = null;
    setActiveChatId(null);
    setMessagesByAgent(initialMessages());
    setPendingInputByAgent(initialPendingInput());
    setBusyByAgent(initialFlag(false));
    setWireState(null);
  }

  async function restartWorkflow() {
    const id = chatIdRef.current;
    if (!id) return;
    if (Object.values(busyByAgent).some(Boolean)) return;
    const ok = window.confirm(
      "Re-enter Git repo URL? This will clear all Reviewer, Coordinator, and Deployer progress for this app and restart the workflow from the beginning.",
    );
    if (!ok) return;
    const res = await fetch(`/api/chats/${id}/restart`, { method: "POST" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      alert(`Restart failed (${res.status}). Try again.`);
      return;
    }
    setMessagesByAgent(initialMessages());
    setPendingInputByAgent(initialPendingInput());
    setBusyByAgent(initialFlag(false));
    setToolStatusByAgent(initialFlag<string | null>(null));
    setWireState(null);
    setActiveAgent("reviewer");
  }

  async function fetchAgentMessages(id: string, agent: AgentId): Promise<Msg[]> {
    const res = await fetch(`/api/chats/${id}/messages?agentId=${agent}`);
    if (res.status === 401) {
      router.push("/login");
      return [];
    }
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ role: string; content: string; toolCalls: unknown }>;
    const mapped: Msg[] = [];
    for (const r of rows) {
      if (r.role === "tool") continue;
      if (r.role === "assistant" && !r.content) continue;
      if (r.role === "user" || r.role === "assistant") {
        mapped.push({ role: r.role, content: r.content });
      }
    }
    return mapped.length ? mapped : [AGENT_INITIAL[agent].greeting];
  }

  async function loadChat(id: string) {
    if (Object.values(busyByAgent).some(Boolean)) return;
    const [reviewer, coordinator, deployer, state] = await Promise.all([
      fetchAgentMessages(id, "reviewer"),
      fetchAgentMessages(id, "coordinator"),
      fetchAgentMessages(id, "deployer"),
      fetch(`/api/chats/${id}/state`).then((r) => (r.ok ? (r.json() as Promise<WireWorkflowState>) : null)),
    ]);
    chatIdRef.current = id;
    setActiveChatId(id);
    setMessagesByAgent({ reviewer, coordinator, deployer });
    setPendingInputByAgent(initialFlag<InputRequest | null>(null));
    setBusyByAgent(initialFlag(false));
    setWireState(null);
    if (state) applyWorkflowState(state);
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
    if (!text) return;
    const agent = activeAgent;
    if (busyByAgent[agent]) return;
    patchMessages(agent, (m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setBusyFor(agent, true);

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
        agentId: agent,
        ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
      }),
    });

    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok || !res.body) {
      patchMessages(agent, (m) => [...m.slice(0, -1), { role: "assistant", content: `error: ${res.status}` }]);
      setBusyFor(agent, false);
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
          patchMessages(agent, (m) => {
            const last = m[m.length - 1];
            if (last?.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, content: last.content + ev.delta }];
          });
        } else if (ev.type === "tool_call") {
          setToolStatusFor(agent, ev.name);
          patchMessages(agent, (m) => [...m, { role: "assistant", content: "" }]);
        } else if (ev.type === "tool_result") {
          setToolStatusFor(agent, null);
        } else if (ev.type === "state_changed") {
          const cid = chatIdRef.current;
          if (cid) refreshWorkflowState(cid).catch(() => {});
        } else if (ev.type === "input_request") {
          patchMessages(agent, (m) => {
            const last = m[m.length - 1];
            if (last?.role === "assistant" && !last.content) {
              return [...m.slice(0, -1), { ...last, content: ev.label }];
            }
            if (last?.role !== "assistant") {
              return [...m, { role: "assistant", content: ev.label }];
            }
            return m;
          });
          setPendingInputFor(agent, {
            inputType: ev.inputType,
            label: ev.label,
            fieldName: ev.fieldName,
            placeholder: ev.placeholder,
            defaultValue: ev.defaultValue,
            options: ev.options,
            required: ev.required,
            envVarSpec: ev.envVarSpec,
            toolCallId: ev.toolCallId,
          });
          setBusyFor(agent, false);
        } else if (ev.type === "error") {
          patchMessages(agent, (m) => [...m, { role: "assistant", content: `error: ${ev.message}` }]);
        }
      }
    }
    setBusyFor(agent, false);
    setToolStatusFor(agent, null);
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
                const titleText = unwrapUserPayload(a.title);
                const hasAppName = !!(a.appName && a.appName.length > 0);
                const label = hasAppName ? a.appName! : (titleText || "Untitled");
                return (
                  <div key={a.id} className={`app-row${active ? " is-active" : ""}`}>
                    <button
                      onClick={() => loadChat(a.id)}
                      className={`app-row-button${hasAppName ? " is-app-named" : ""}`}
                      title={titleText}
                    >
                      {label}
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
        <header className="app-header">
          <div className="app-header-left">
            <button onClick={() => setSidebarOpen((v) => !v)} title="Toggle applications" className="btn-icon">
              <Menu size={16} strokeWidth={2} />
            </button>
            <strong>Vibe Deployment</strong>
          </div>
          <nav className="agent-tabs" role="tablist" aria-label="AI Agents">
            {AGENTS.map(({ id, label, Icon }) => {
              const active = id === activeAgent;
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveAgent(id)}
                  className={`agent-tab${active ? " is-active" : ""}`}
                  title={label}
                >
                  <Icon size={14} strokeWidth={2} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
          <button onClick={logout} title="Logout" className="btn-icon">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </header>

        <div className="content-stream">
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            if (m.role === "assistant" && !m.content && !(busy && isLast)) return null;
            if (m.role === "tool") return null;
            const bubbleClass = m.role === "user" ? "bubble bubble-user" : "bubble bubble-assistant";
            return (
              <div key={i} className={bubbleClass}>
                <div className="bubble-meta">
                  {m.role === "assistant" ? (
                    <>
                      <Bot size={14} strokeWidth={2} aria-label="AI" />
                      <span>Assistance</span>
                    </>
                  ) : (
                    <>
                      <User size={14} strokeWidth={2} aria-label="User" />
                      <span>User</span>
                    </>
                  )}
                </div>
                <div className="bubble-body">
                  {m.role === "assistant" ? (
                    <div className="markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, ...props }) => (
                            <a {...props} target="_blank" rel="noopener noreferrer" />
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    unwrapUserPayload(m.content)
                  )}
                  {busy && i === messages.length - 1 && m.role === "assistant" && (
                    <span className="blink-cursor">▍</span>
                  )}
                </div>
              </div>
            );
          })}
          {toolStatus && (
            <div className="tool-status-pill">
              <span className="tool-status-spinner" />
              <span>{toolStatus}</span>
            </div>
          )}
        </div>

        {activeAgent === "deployer" &&
        collected &&
        messages.length === 1 &&
        messages[0].role === "assistant" &&
        !busy ? (
          <div className="composer-gated">
            <button
              onClick={() => setActiveAgent("coordinator")}
              className="btn"
            >
              ← Back to Coordinator
            </button>
            <button
              onClick={() => sendWithValue("Deploy now.")}
              className="btn btn-primary"
            >
              Deploy
            </button>
          </div>
        ) : activeAgent === "reviewer" && reviewerReady ? (
          <div className="composer-gated">
            <button
              onClick={restartWorkflow}
              title="Re-enter Git repo URL (restart workflow)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                fontSize: "12px",
                background: "transparent",
                border: "1px solid var(--border-dim)",
                color: "var(--text-dim)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              <RefreshCcw size={12} strokeWidth={2} />
              <span>Re-enter URL</span>
            </button>
            <span style={{ marginLeft: "auto" }}>Repo is ready for Coolify deployment.</span>
            <button onClick={() => setActiveAgent("coordinator")} className="btn btn-primary">
              Talk to Coordinator →
            </button>
          </div>
        ) : isGatedDeployer ? (
          <div className="composer-gated">
            <span>Please talk to the Coordinator first.</span>
            <button onClick={() => setActiveAgent("coordinator")} className="btn btn-primary">
              Go to Coordinator →
            </button>
          </div>
        ) : isGatedCoordinator ? (
          <div className="composer-gated">
            <span>Please talk to the Reviewer first.</span>
            <button onClick={() => setActiveAgent("reviewer")} className="btn btn-primary">
              Go to Reviewer →
            </button>
          </div>
        ) : pendingInput ? (
          <div className="content-narrow">
            <DynamicInput
              request={pendingInput}
              disabled={busy}
              onSubmit={(value) => {
                const { label, fieldName } = pendingInput;
                setPendingInputFor(activeAgent, null);
                sendWithValue(value, fieldName, label);
              }}
            />
          </div>
        ) : activeAgent === "coordinator" && collected ? (
          <div className="composer-with-handoff">
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
            <div className="composer-handoff-row">
              <span>All set: app name + env vars collected.</span>
              <button
                onClick={() => setActiveAgent("deployer")}
                className="btn btn-primary"
              >
                Talk to Deployer →
              </button>
            </div>
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
