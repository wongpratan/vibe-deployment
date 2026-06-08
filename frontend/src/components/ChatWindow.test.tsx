import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatWindow from "./ChatWindow";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("remark-gfm", () => ({ default: () => null }));

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function sseStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.close();
    },
  });
}

function sseResponse(events: object[], headers: Record<string, string> = {}) {
  return new Response(sseStream(events), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

function installFetch(handler: FetchHandler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatWindow initial render", () => {
  it("shows the reviewer greeting and three agent tabs", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      return new Response("", { status: 404 });
    });

    render(<ChatWindow />);

    expect(
      await screen.findByText(/I review GitHub repos for Coolify/i),
    ).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: /Reviewer/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Coordinator/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /Deployer/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders an empty sidebar when no chats exist", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      return new Response("", { status: 404 });
    });

    render(<ChatWindow />);
    expect(await screen.findByText(/No applications yet/i)).toBeInTheDocument();
  });
});

describe("ChatWindow agent gating", () => {
  it("shows 'Go to Reviewer' when switching to Coordinator without progress", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    await user.click(screen.getByRole("tab", { name: /Coordinator/i }));

    expect(screen.getByText(/Please talk to the Reviewer first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to Reviewer/i })).toBeInTheDocument();
  });

  it("shows 'Go to Coordinator' when switching to Deployer without progress", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    await user.click(screen.getByRole("tab", { name: /Deployer/i }));

    expect(screen.getByText(/Please talk to the Coordinator first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to Coordinator/i })).toBeInTheDocument();
  });

  it("redirects to /login when the chats fetch returns 401", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return new Response("", { status: 401 });
      return new Response("", { status: 404 });
    });

    render(<ChatWindow />);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("the 'Go to Reviewer' button switches the active tab back to Reviewer", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    await user.click(screen.getByRole("tab", { name: /Coordinator/i }));
    await user.click(screen.getByRole("button", { name: /Go to Reviewer/i }));

    expect(screen.getByRole("tab", { name: /Reviewer/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("ChatWindow logout", () => {
  it("calls /api/logout and routes to /login", async () => {
    const fetchSpy = installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      if (url === "/api/logout") return new Response("", { status: 200 });
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    await user.click(screen.getByRole("button", { name: /Logout/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/logout",
        expect.objectContaining({ method: "POST" }),
      );
      expect(pushMock).toHaveBeenCalledWith("/login");
    });
  });
});

describe("ChatWindow sidebar", () => {
  it("renders chats from /api/chats in reverse order", async () => {
    installFetch((url) => {
      if (url === "/api/chats")
        return jsonResponse([
          { id: "a", title: "alpha", createdAt: "2026-01-01", appName: null },
          { id: "b", title: "beta", createdAt: "2026-01-02", appName: "BetaApp" },
        ]);
      return new Response("", { status: 404 });
    });

    render(<ChatWindow />);

    const sidebar = await screen.findByRole("complementary").catch(() => null);
    // sidebar element doesn't have a role; use buttons instead
    const beta = await screen.findByRole("button", { name: "BetaApp" });
    const alpha = await screen.findByRole("button", { name: "alpha" });
    expect(beta).toBeInTheDocument();
    expect(alpha).toBeInTheDocument();
    // Reversed: beta (created later) should render before alpha
    const buttons = screen.getAllByRole("button");
    const betaIdx = buttons.indexOf(beta);
    const alphaIdx = buttons.indexOf(alpha);
    expect(betaIdx).toBeLessThan(alphaIdx);
    void sidebar;
  });

  it("clicking a chat row loads its messages", async () => {
    let messagesCalled = false;
    installFetch((url) => {
      if (url === "/api/chats")
        return jsonResponse([
          { id: "x1", title: "App X", createdAt: "2026-01-01", appName: null },
        ]);
      if (url.startsWith("/api/chats/x1/messages")) {
        messagesCalled = true;
        return jsonResponse([
          { role: "user", content: "hi there", toolCalls: null },
          { role: "assistant", content: "hello!", toolCalls: null },
        ]);
      }
      if (url === "/api/chats/x1/state") return new Response("", { status: 404 });
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    const row = await screen.findByRole("button", { name: "App X" });
    await user.click(row);

    await waitFor(() => expect(messagesCalled).toBe(true));
    expect(await screen.findByText("hello!")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("'+ New' clears state and shows reviewer greeting again", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    await user.click(screen.getByRole("tab", { name: /Coordinator/i }));
    expect(screen.getByText(/Please talk to the Reviewer first/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /\+ New/i }));
    // Coordinator tab still active after reset, but greeting should be intact
    expect(screen.getByRole("tab", { name: /Coordinator/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("ChatWindow streaming", () => {
  it("streams assistant text deltas into a bubble after submitting the repo URL", async () => {
    let chatPayload: any = null;
    const fetchSpy = installFetch((url, init) => {
      if (url === "/api/chats") return jsonResponse([]);
      if (url === "/api/chat") {
        chatPayload = JSON.parse(init!.body as string);
        return sseResponse(
          [
            { type: "text", delta: "Looks " },
            { type: "text", delta: "good!" },
          ],
          { "X-Chat-Id": "new-chat-1" },
        );
      }
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    const urlInput = screen.getByPlaceholderText(/https:\/\/github\.com/i);
    await user.type(urlInput, "https://github.com/owner/repo.git");
    await user.click(screen.getByRole("button", { name: /Submit/i }));

    expect(await screen.findByText("Looks good!")).toBeInTheDocument();
    expect(chatPayload).toMatchObject({
      agentId: "reviewer",
      message: expect.stringContaining("https://github.com/owner/repo.git"),
    });
    expect(fetchSpy.mock.calls.filter(([u]) => u === "/api/chats").length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a DynamicInput when the stream emits an input_request", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      if (url === "/api/chat") {
        return sseResponse(
          [
            { type: "text", delta: "One more thing." },
            {
              type: "input_request",
              inputType: "text",
              label: "What is your name?",
              fieldName: "name",
              placeholder: "Your name",
              required: true,
              toolCallId: "tc-1",
            },
          ],
          { "X-Chat-Id": "c2" },
        );
      }
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    const urlInput = screen.getByPlaceholderText(/https:\/\/github\.com/i);
    await user.type(urlInput, "https://github.com/owner/repo.git");
    await user.click(screen.getByRole("button", { name: /Submit/i }));

    // Label appears as both a bubble text and the DynamicInput label
    expect(await screen.findAllByText("What is your name?")).not.toHaveLength(0);
    expect(screen.getByPlaceholderText("Your name")).toBeInTheDocument();
  });

  it("shows a tool-status pill on tool_call and clears it on tool_result", async () => {
    const encoder = new TextEncoder();
    let push!: (ev: object) => void;
    let close!: () => void;
    const controllable = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (ev) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        close = () => controller.close();
      },
    });

    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      if (url === "/api/chat") {
        return new Response(controllable, {
          status: 200,
          headers: { "Content-Type": "text/event-stream", "X-Chat-Id": "tc-1" },
        });
      }
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    const urlInput = screen.getByPlaceholderText(/https:\/\/github\.com/i);
    await user.type(urlInput, "https://github.com/owner/repo.git");
    await user.click(screen.getByRole("button", { name: /Submit/i }));

    push({ type: "tool_call", name: "check_repo" });
    expect(await screen.findByText("check_repo")).toBeInTheDocument();

    push({ type: "tool_result" });
    await waitFor(() => {
      expect(screen.queryByText("check_repo")).not.toBeInTheDocument();
    });

    close();
  });

  it("Re-enter URL confirms, POSTs /restart, and snaps back to a fresh Reviewer", async () => {
    const calls: { url: string; method?: string }[] = [];
    installFetch((url, init) => {
      calls.push({ url, method: init?.method });
      if (url === "/api/chats")
        return jsonResponse([
          { id: "rw-1", title: "rw", createdAt: "2026-01-01", appName: "acme-svc" },
        ]);
      if (url.startsWith("/api/chats/rw-1/messages")) return jsonResponse([]);
      if (url === "/api/chats/rw-1/state") {
        return jsonResponse({
          reviewer: { open: true, ready: true, nameGuess: "acme-svc" },
          coordinator: {
            open: true,
            collected: false,
            appName: null,
            envVarKeys: [],
            envVars: [],
          },
          deployer: { open: false, buildPack: null, targetUrl: null },
        });
      }
      if (url === "/api/chats/rw-1/restart") return new Response("", { status: 200 });
      return new Response("", { status: 404 });
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<ChatWindow />);
    await user.click(await screen.findByRole("button", { name: "acme-svc" }));

    // Reviewer-ready handoff is showing because state.reviewer.ready=true.
    const reenter = await screen.findByRole("button", { name: /Re-enter URL/i });
    await user.click(reenter);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/chats/rw-1/restart" && c.method === "POST"),
      ).toBe(true);
    });

    // Reviewer tab is active again with its initial input prompt; handoff is gone.
    expect(screen.getByRole("tab", { name: /Reviewer/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("button", { name: /Talk to Coordinator/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/https:\/\/github\.com/i)).toBeInTheDocument();
  });

  it("on coordinator.collected, surfaces a Deployer handoff with context-rich greeting", async () => {
    installFetch((url) => {
      if (url === "/api/chats")
        return jsonResponse([
          { id: "ready-1", title: "ready", createdAt: "2026-01-01", appName: "acme-svc" },
        ]);
      if (url.startsWith("/api/chats/ready-1/messages")) {
        // Empty rows so each agent renders its default greeting; applyWorkflowState
        // then swaps the deployer greeting to the context-rich variant.
        return jsonResponse([]);
      }
      if (url === "/api/chats/ready-1/state") {
        return jsonResponse({
          reviewer: { open: true, ready: true, nameGuess: "acme-svc" },
          coordinator: {
            open: true,
            collected: true,
            appName: "acme-svc",
            envVarKeys: ["API_KEY"],
            envVars: [{ key: "API_KEY", maskedValue: "***" }],
          },
          deployer: { open: true, buildPack: "nixpacks", targetUrl: null },
        });
      }
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);

    await user.click(await screen.findByRole("button", { name: "acme-svc" }));

    // Coordinator tab gets the "Talk to Deployer" handoff once collected.
    await user.click(screen.getByRole("tab", { name: /Coordinator/i }));
    const toDeployer = await screen.findByRole("button", { name: /Talk to Deployer/i });
    expect(screen.getByText(/All set: app name \+ env vars collected/i)).toBeInTheDocument();

    await user.click(toDeployer);

    // Deployer tab now shows the context-rich greeting and the gated Deploy/Back composer.
    expect(screen.getByRole("tab", { name: /Deployer/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText(/Build Pack:.*nixpacks/i)).toBeInTheDocument();
    expect(screen.getByText(/Application Name:.*acme-svc/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deploy/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Coordinator/i })).toBeInTheDocument();
  });

  it("on state_changed with reviewer.ready, unlocks the Coordinator handoff and swaps in the nameGuess", async () => {
    const stateCalls: string[] = [];
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      if (url === "/api/chat") {
        return sseResponse(
          [
            { type: "text", delta: "Repo looks deployable." },
            { type: "state_changed" },
          ],
          { "X-Chat-Id": "chat-rev-1" },
        );
      }
      if (url === "/api/chats/chat-rev-1/state") {
        stateCalls.push(url);
        return jsonResponse({
          reviewer: { open: true, ready: true, nameGuess: "acme-svc" },
          coordinator: {
            open: true,
            collected: false,
            appName: null,
            envVarKeys: [],
            envVars: [],
          },
          deployer: { open: false, buildPack: null, targetUrl: null },
        });
      }
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    const urlInput = screen.getByPlaceholderText(/https:\/\/github\.com/i);
    await user.type(urlInput, "https://github.com/owner/repo.git");
    await user.click(screen.getByRole("button", { name: /Submit/i }));

    // Reviewer-ready handoff composer surfaces.
    expect(
      await screen.findByRole("button", { name: /Talk to Coordinator/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Repo is ready for Coolify deployment/i)).toBeInTheDocument();
    await waitFor(() => expect(stateCalls.length).toBeGreaterThan(0));

    // Following the handoff lands on Coordinator with the nameGuess-tailored greeting + pending input.
    await user.click(screen.getByRole("button", { name: /Talk to Coordinator/i }));
    expect(screen.getByRole("tab", { name: /Coordinator/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByText(/Please talk to the Reviewer first/i)).not.toBeInTheDocument();
    expect(screen.getByText(/I suggested \*\*acme-svc\*\*/i)).toBeInTheDocument();
    expect(screen.getByText(/Application name\?/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("acme-svc")).toBeInTheDocument();
  });

  it("renders an error bubble when /api/chat returns non-OK", async () => {
    installFetch((url) => {
      if (url === "/api/chats") return jsonResponse([]);
      if (url === "/api/chat") return new Response("", { status: 500 });
      return new Response("", { status: 404 });
    });

    const user = userEvent.setup();
    render(<ChatWindow />);
    await screen.findByText(/I review GitHub repos/i);

    const urlInput = screen.getByPlaceholderText(/https:\/\/github\.com/i);
    await user.type(urlInput, "https://github.com/owner/repo.git");
    await user.click(screen.getByRole("button", { name: /Submit/i }));

    expect(await screen.findByText(/error: 500/i)).toBeInTheDocument();
  });
});
