import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LoginPage", () => {
  it("starts in login mode by default", () => {
    render(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Need an account\? Register/i }),
    ).toBeInTheDocument();
  });

  it("toggles to register mode and back", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(
      screen.getByRole("button", { name: /Need an account\? Register/i }),
    );
    expect(screen.getByRole("heading", { name: "Register" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Have an account\? Login/i }),
    );
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });

  it("submits to /api/auth/login and navigates on success", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ user: { id: "u1" } }));

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText("email"), "p@x.com");
    await user.type(
      screen.getByPlaceholderText(/password \(min 8 chars\)/i),
      "longenough",
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(refreshMock).toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "p@x.com",
      password: "longenough",
    });
  });

  it("posts to /api/auth/register when in register mode", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ user: { id: "u2" } }));

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(
      screen.getByRole("button", { name: /Need an account\? Register/i }),
    );

    await user.type(screen.getByPlaceholderText("email"), "p@x.com");
    await user.type(
      screen.getByPlaceholderText(/password \(min 8 chars\)/i),
      "longenough",
    );
    await user.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/auth/register");
  });

  it("renders the upstream error message on failed submit", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "bad credentials" }, { status: 401 }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("email"), "p@x.com");
    await user.type(
      screen.getByPlaceholderText(/password \(min 8 chars\)/i),
      "longenough",
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByText("bad credentials")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("falls back to 'failed' when the error body is not JSON", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("not json", { status: 500 }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("email"), "p@x.com");
    await user.type(
      screen.getByPlaceholderText(/password \(min 8 chars\)/i),
      "longenough",
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByText("failed")).toBeInTheDocument();
  });

  it("disables the submit button while a request is in flight", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve)),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText("email"), "p@x.com");
    await user.type(
      screen.getByPlaceholderText(/password \(min 8 chars\)/i),
      "longenough",
    );
    await user.click(screen.getByRole("button", { name: "Login" }));

    // While in-flight, button label is "..." and disabled
    const busyBtn = await screen.findByRole("button", { name: "..." });
    expect(busyBtn).toBeDisabled();

    resolveFetch(jsonResponse({ user: { id: "u1" } }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });
});
