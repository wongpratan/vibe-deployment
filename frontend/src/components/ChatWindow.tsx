"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, ClipboardCheck, LogOut, Menu, Network, RefreshCcw, Rocket, Trash2, User, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DynamicInput, { type InputRequest } from "./DynamicInput";

type Msg =
  | { role: "user" | "assistant"; content: string }
  | { role: "tool"; name: string; content: string };

type AppItem = { id: string; title: string; createdAt: string };

type AgentId = "reviewer" | "coordinator" | "deployer";

const AGENTS: { id: AgentId; label: string; Icon: typeof ClipboardCheck }[] = [
  { id: "reviewer", label: "Reviewer", Icon: ClipboardCheck },
  { id: "coordinator", label: "Coordinator", Icon: Network },
  { id: "deployer", label: "Deployer", Icon: Rocket },
];

type SaveStatus = { phase: "saving" | "saved" | "error"; detail?: string } | null;
type AgentMap<T> = Record<AgentId, T>;

function maskEnvVarsPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.envVars)) return null;
    const keys = parsed.envVars.map((v: { key: string }) => v.key).filter(Boolean);
    if (keys.length === 0) return "Env vars: (none)";
    return `Env vars set: ${keys.join(", ")}`;
  } catch {
    return null;
  }
}

function unwrapUserPayload(content: string): string {
  const m1 = content.match(/^My .+? is "([\s\S]*)"\.$/);
  if (m1) {
    const masked = maskEnvVarsPayload(m1[1]);
    return masked ?? m1[1];
  }
  const m2 = content.match(/^Answer to ".+?": ([\s\S]*)$/);
  if (m2) {
    const masked = maskEnvVarsPayload(m2[1]);
    return masked ?? m2[1];
  }
  return content;
}

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
  placeholder: "https://github.com/owner/repo",
  required: true,
  toolCallId: "",
};

function coordinatorGreeting(nameGuess: string | null): Msg {
  const suffix = nameGuess
    ? ` I suggested **${nameGuess}** below — keep it or type a different name.`
    : "";
  return {
    role: "assistant",
    content: `Hi! I'm the Coordinator. Confirm the application name below, then I'll collect any environment variables it needs.${suffix}`,
  };
}

function coordinatorAppNameInput(nameGuess: string | null): InputRequest {
  return {
    inputType: "text",
    label: "Application name?",
    fieldName: "application name",
    defaultValue: nameGuess ?? undefined,
    required: true,
    toolCallId: "",
  };
}

const COORDINATOR_GREETING: Msg = coordinatorGreeting(null);

type DeployerContext = {
  collected: boolean;
  appName: string | null;
  envVarKeys: string[];
  envVars: { key: string; maskedValue: string }[];
  buildPack: string | null;
};

function deployerGreeting(ctx: DeployerContext | null): Msg {
  if (!ctx || !ctx.collected) {
    return {
      role: "assistant",
      content: "Hi! I'm the Deployer. I help execute and monitor deployments. What would you like to deploy?",
    };
  }
  const bp = ctx.buildPack ?? "not detected";
  const name = ctx.appName ?? "(not set)";
  const envBlock =
    ctx.envVars.length > 0
      ? [
          "**Environment Variables:**",
          "",
          "| Key | Value |",
          "| --- | --- |",
          ...ctx.envVars.map((v) => `| \`${v.key}\` | \`${v.maskedValue}\` |`),
        ].join("\n")
      : "- **Environment Variables:** none";
  return {
    role: "assistant",
    content: [
      "Hi! I'm the Deployer. Here's what's ready to deploy:",
      "",
      `- **Build Pack:** ${bp}`,
      `- **Application Name:** ${name}`,
      "",
      envBlock,
      "",
      "Would you like to **deploy now**, or go **back to the Coordinator** to change the settings?",
    ].join("\n"),
  };
}

const DEPLOYER_GREETING: Msg = deployerGreeting(null);

const AGENT_INITIAL: AgentMap<{ greeting: Msg; input: InputRequest | null }> = {
  reviewer: { greeting: REVIEWER_GREETING, input: REVIEWER_INITIAL_INPUT },
  coordinator: { greeting: COORDINATOR_GREETING, input: null },
  deployer: { greeting: DEPLOYER_GREETING, input: null },
};

const SAVE_TOOL = "save_deployment_requirements";
const REVIEW_TOOL = "save_review_result";
const COORDINATOR_TOOL = "save_coordinator_requirements";

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
  const [saveStatusByAgent, setSaveStatusByAgent] = useState<AgentMap<SaveStatus>>(() => initialFlag<SaveStatus>(null));
  const [pendingInputByAgent, setPendingInputByAgent] = useState<AgentMap<InputRequest | null>>(initialPendingInput);
  const [toolStatusByAgent, setToolStatusByAgent] = useState<AgentMap<string | null>>(() => initialFlag<string | null>(null));
  const [readyForCoordinatorByAgent, setReadyForCoordinatorByAgent] = useState<AgentMap<boolean>>(() => initialFlag(false));
  const [deployerContext, setDeployerContext] = useState<DeployerContext | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeAgent, setActiveAgent] = useState<AgentId>("reviewer");

  const messages = messagesByAgent[activeAgent];
  const busy = busyByAgent[activeAgent];
  const saveStatus = saveStatusByAgent[activeAgent];
  const pendingInput = pendingInputByAgent[activeAgent];
  const toolStatus = toolStatusByAgent[activeAgent];
  const reviewerReady = readyForCoordinatorByAgent.reviewer;
  const isGatedCoordinator = activeAgent === "coordinator" && !reviewerReady;
  const isGatedDeployer = activeAgent === "deployer" && !deployerContext?.collected;
  const isGated = isGatedCoordinator || isGatedDeployer;

  function patchMessages(agent: AgentId, fn: (prev: Msg[]) => Msg[]) {
    setMessagesByAgent((s) => ({ ...s, [agent]: fn(s[agent]) }));
  }
  function setBusyFor(agent: AgentId, value: boolean) {
    setBusyByAgent((s) => ({ ...s, [agent]: value }));
  }
  function setSaveStatusFor(agent: AgentId, value: SaveStatus) {
    setSaveStatusByAgent((s) => ({ ...s, [agent]: value }));
  }
  function setPendingInputFor(agent: AgentId, value: InputRequest | null) {
    setPendingInputByAgent((s) => ({ ...s, [agent]: value }));
  }
  function setToolStatusFor(agent: AgentId, value: string | null) {
    setToolStatusByAgent((s) => ({ ...s, [agent]: value }));
  }
  function setReadyForCoordinatorFor(agent: AgentId, value: boolean) {
    setReadyForCoordinatorByAgent((s) => ({ ...s, [agent]: value }));
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

  function resetToNew() {
    chatIdRef.current = null;
    setActiveChatId(null);
    setMessagesByAgent(initialMessages());
    setPendingInputByAgent(initialPendingInput());
    setBusyByAgent(initialFlag(false));
    setSaveStatusByAgent(initialFlag<SaveStatus>(null));
    setReadyForCoordinatorByAgent(initialFlag(false));
    setDeployerContext(null);
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
    setSaveStatusByAgent(initialFlag<SaveStatus>(null));
    setToolStatusByAgent(initialFlag<string | null>(null));
    setReadyForCoordinatorByAgent(initialFlag(false));
    setDeployerContext(null);
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
    const [reviewer, coordinator, deployer, reviewStatus, coordinatorStatus] = await Promise.all([
      fetchAgentMessages(id, "reviewer"),
      fetchAgentMessages(id, "coordinator"),
      fetchAgentMessages(id, "deployer"),
      fetch(`/api/chats/${id}/review-status`).then((r) => (r.ok ? r.json() : { ready: false })),
      fetch(`/api/chats/${id}/coordinator-status`).then((r) =>
        r.ok ? r.json() : { collected: false, appName: null, envVarKeys: [], envVars: [], buildPack: null },
      ),
    ]);
    chatIdRef.current = id;
    setActiveChatId(id);
    const nameGuess: string | null = reviewStatus?.nameGuess ?? null;
    const coordinatorWithGuess =
      nameGuess && coordinator.length === 1 && coordinator[0].role === "assistant"
        ? [coordinatorGreeting(nameGuess)]
        : coordinator;
    const ctx: DeployerContext = {
      collected: !!coordinatorStatus.collected,
      appName: coordinatorStatus.appName ?? null,
      envVarKeys: Array.isArray(coordinatorStatus.envVarKeys) ? coordinatorStatus.envVarKeys : [],
      envVars: Array.isArray(coordinatorStatus.envVars) ? coordinatorStatus.envVars : [],
      buildPack: coordinatorStatus.buildPack ?? null,
    };
    const deployerWithSummary =
      ctx.collected && deployer.length === 1 && deployer[0].role === "assistant"
        ? [deployerGreeting(ctx)]
        : deployer;
    setMessagesByAgent({ reviewer, coordinator: coordinatorWithGuess, deployer: deployerWithSummary });
    const coordinatorNeedsAppName =
      !!reviewStatus.ready && !ctx.collected && coordinatorWithGuess.length === 1;
    setPendingInputByAgent({
      ...initialFlag<InputRequest | null>(null),
      coordinator: coordinatorNeedsAppName ? coordinatorAppNameInput(nameGuess) : null,
    });
    setBusyByAgent(initialFlag(false));
    setSaveStatusByAgent(initialFlag<SaveStatus>(null));
    setReadyForCoordinatorByAgent({ ...initialFlag(false), reviewer: !!reviewStatus.ready });
    setDeployerContext(ctx);
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
          if (ev.name === SAVE_TOOL) {
            setSaveStatusFor(agent, { phase: "saving" });
          } else {
            setToolStatusFor(agent, ev.name);
            patchMessages(agent, (m) => [...m, { role: "assistant", content: "" }]);
          }
        } else if (ev.type === "tool_result") {
          if (ev.name === REVIEW_TOOL) {
            let parsed: any = null;
            try { parsed = JSON.parse(ev.result); } catch {}
            if (parsed?.status === "saved" && parsed?.ready === true) {
              setReadyForCoordinatorFor(agent, true);
              const guess: string | null =
                typeof parsed.nameGuess === "string" && parsed.nameGuess ? parsed.nameGuess : null;
              setMessagesByAgent((s) => {
                const cur = s.coordinator;
                const onlyGreeting = cur.length === 1 && cur[0].role === "assistant";
                if (!onlyGreeting) return s;
                return { ...s, coordinator: [coordinatorGreeting(guess)] };
              });
              setPendingInputByAgent((s) => {
                if (s.coordinator) return s;
                return { ...s, coordinator: coordinatorAppNameInput(guess) };
              });
            }
            setToolStatusFor(agent, null);
          } else if (ev.name === COORDINATOR_TOOL) {
            let parsed: any = null;
            try { parsed = JSON.parse(ev.result); } catch {}
            if (parsed?.status === "saved" && parsed?.collected === true) {
              const cid = chatIdRef.current;
              if (cid) {
                fetch(`/api/chats/${cid}/coordinator-status`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((data) => {
                    if (!data) return;
                    const ctx: DeployerContext = {
                      collected: !!data.collected,
                      appName: data.appName ?? null,
                      envVarKeys: Array.isArray(data.envVarKeys) ? data.envVarKeys : [],
                      envVars: Array.isArray(data.envVars) ? data.envVars : [],
                      buildPack: data.buildPack ?? null,
                    };
                    setDeployerContext(ctx);
                    setMessagesByAgent((s) => {
                      const cur = s.deployer;
                      const onlyGreeting = cur.length === 1 && cur[0].role === "assistant";
                      if (!onlyGreeting || !ctx.collected) return s;
                      return { ...s, deployer: [deployerGreeting(ctx)] };
                    });
                  })
                  .catch(() => {});
              }
            }
            setToolStatusFor(agent, null);
          } else if (ev.name === SAVE_TOOL) {
            let parsed: any = null;
            try { parsed = JSON.parse(ev.result); } catch {}
            if (parsed?.status === "saved") {
              setSaveStatusFor(agent, { phase: "saved" });
              setTimeout(() => setSaveStatusFor(agent, null), 4000);
              refreshApps();
            } else {
              setSaveStatusFor(agent, { phase: "error", detail: parsed?.error ?? ev.result });
            }
          } else {
            setToolStatusFor(agent, null);
          }
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
                      title={unwrapUserPayload(a.title)}
                    >
                      {unwrapUserPayload(a.title) || "Untitled"}
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
                  onClick={() => setSaveStatusFor(activeAgent, null)}
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
        deployerContext?.collected &&
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
        ) : activeAgent === "coordinator" && deployerContext?.collected ? (
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
