import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

const getMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error("REDIRECT");
});

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: getMock }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/components/ChatWindow", () => ({
  default: () => <div data-testid="chat-window" />,
}));

beforeEach(() => {
  getMock.mockReset();
  redirectMock.mockClear();
});

describe("Home", () => {
  it("redirects to /login when the auth cookie is absent", async () => {
    getMock.mockReturnValue(undefined);
    await expect(Home()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("renders ChatWindow when the auth cookie has a value", async () => {
    getMock.mockReturnValue({ value: "tok-123" });
    const element = await Home();
    render(element);
    expect(screen.getByTestId("chat-window")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when the cookie value is an empty string", async () => {
    getMock.mockReturnValue({ value: "" });
    await expect(Home()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
