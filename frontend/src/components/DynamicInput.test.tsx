import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DynamicInput, { type InputRequest } from "./DynamicInput";

function renderInput(
  overrides: Partial<InputRequest> & Pick<InputRequest, "inputType" | "label">,
  opts: { disabled?: boolean } = {},
) {
  const onSubmit = vi.fn();
  const request: InputRequest = {
    toolCallId: "tc-1",
    ...overrides,
  } as InputRequest;
  const utils = render(
    <DynamicInput request={request} onSubmit={onSubmit} disabled={opts.disabled} />,
  );
  return { onSubmit, ...utils };
}

describe("DynamicInput - default text fallback", () => {
  it("renders a text input via the default branch", async () => {
    const { onSubmit } = renderInput({ inputType: "text", label: "Name?" });
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Type your answer...");
    await user.type(input, "Pong");
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("Pong");
  });

  it("submits on Enter key", async () => {
    const { onSubmit } = renderInput({ inputType: "text", label: "Name?" });
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Type your answer...");
    await user.type(input, "Pong{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Pong");
  });

  it("disables Submit when required and empty", () => {
    renderInput({ inputType: "text", label: "Name?", required: true });
    expect(screen.getByRole("button", { name: /Submit/i })).toBeDisabled();
  });

  it("disables everything when disabled prop is true", () => {
    renderInput({ inputType: "text", label: "Name?" }, { disabled: true });
    expect(screen.getByRole("button", { name: /Submit/i })).toBeDisabled();
    expect(screen.getByPlaceholderText("Type your answer...")).toBeDisabled();
  });
});

describe("DynamicInput - github_url", () => {
  it("shows a validation error for non-github URLs and blocks submit", async () => {
    const { onSubmit } = renderInput({
      inputType: "github_url",
      label: "Repo?",
      required: true,
    });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "https://gitlab.com/x/y");
    expect(
      screen.getByText(/Must be a valid github\.com\/owner\/repo URL/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts a valid github.com URL and submits", async () => {
    const { onSubmit } = renderInput({
      inputType: "github_url",
      label: "Repo?",
      required: true,
    });
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox"),
      "https://github.com/owner/repo.git",
    );
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("https://github.com/owner/repo.git");
  });

  it("treats malformed URLs as invalid", async () => {
    renderInput({
      inputType: "github_url",
      label: "Repo?",
      required: true,
    });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "not-a-url");
    expect(
      screen.getByText(/Must be a valid github\.com\/owner\/repo URL/i),
    ).toBeInTheDocument();
  });
});

describe("DynamicInput - url, email, number, date", () => {
  it("renders a url input with default placeholder", () => {
    renderInput({ inputType: "url", label: "Website?" });
    expect(screen.getByPlaceholderText("https://")).toBeInTheDocument();
  });

  it("renders an email input with default placeholder", () => {
    renderInput({ inputType: "email", label: "Email?" });
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });

  it("renders a number input and submits the typed value", async () => {
    const { onSubmit } = renderInput({
      inputType: "number",
      label: "Port?",
      placeholder: "3000",
    });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("3000"), "8080");
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("8080");
  });

  it("renders a date input and submits its value", async () => {
    const { onSubmit, container } = renderInput({
      inputType: "date",
      label: "When?",
      defaultValue: "2026-01-01",
    });
    expect(container.querySelector('input[type="date"]')).toHaveValue("2026-01-01");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("2026-01-01");
  });
});

describe("DynamicInput - color", () => {
  it("uses #000000 when no defaultValue is provided", () => {
    const { container } = renderInput({ inputType: "color", label: "Pick" });
    const input = container.querySelector('input[type="color"]')!;
    expect(input).toHaveValue("#000000");
    expect(screen.getByText("#000000")).toBeInTheDocument();
  });

  it("uses the provided defaultValue", async () => {
    const { onSubmit, container } = renderInput({
      inputType: "color",
      label: "Pick",
      defaultValue: "#ff00aa",
    });
    expect(container.querySelector('input[type="color"]')).toHaveValue("#ff00aa");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("#ff00aa");
  });
});

describe("DynamicInput - password", () => {
  it("toggles between password and text mode via Show/Hide", async () => {
    renderInput({ inputType: "password", label: "Secret?" });
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Enter password...");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /^Show$/ }));
    expect(input).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /^Hide$/ }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("submits the password value", async () => {
    const { onSubmit } = renderInput({
      inputType: "password",
      label: "Secret?",
    });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Enter password..."), "hunter2");
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("hunter2");
  });
});

describe("DynamicInput - select", () => {
  it("renders all options and submits the chosen one", async () => {
    const { onSubmit } = renderInput({
      inputType: "select",
      label: "Pick one",
      options: ["alpha", "beta", "gamma"],
      required: true,
    });
    const user = userEvent.setup();
    expect(screen.getByRole("option", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "— choose —" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "beta");
    await user.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onSubmit).toHaveBeenCalledWith("beta");
  });

  it("blocks submit while still on the placeholder option when required", () => {
    renderInput({
      inputType: "select",
      label: "Pick one",
      options: ["a", "b"],
      required: true,
    });
    expect(screen.getByRole("button", { name: /Submit/i })).toBeDisabled();
  });
});

describe("DynamicInput - file", () => {
  it("does not render a Submit button for file inputs", () => {
    renderInput({ inputType: "file", label: "Upload" });
    expect(screen.queryByRole("button", { name: /Submit/i })).toBeNull();
  });

  it("reads small files and submits their text content", async () => {
    const { onSubmit, container } = renderInput({
      inputType: "file",
      label: "Upload",
    });
    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve("hello world"),
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("hello world"),
    );
  });

  it("rejects files larger than 1MB with a too-large stub message", async () => {
    const { onSubmit, container } = renderInput({
      inputType: "file",
      label: "Upload",
    });
    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: 1024 * 1024 + 1 });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatch(/too large to send/);
    expect(onSubmit.mock.calls[0][0]).toContain("big.bin");
  });
});

describe("DynamicInput - env_vars", () => {
  it("shows an empty-state message when no env vars are specified", () => {
    renderInput({ inputType: "env_vars", label: "Env" });
    expect(screen.getByText(/No environment variables detected/i)).toBeInTheDocument();
  });

  it("renders each env var with masked input and a Show toggle", async () => {
    renderInput({
      inputType: "env_vars",
      label: "Env",
      envVarSpec: [
        { key: "DATABASE_URL", required: true, source: "Dockerfile" },
        { key: "FEATURE_FLAG", required: false, defaultValue: "off" },
      ],
    });
    const user = userEvent.setup();

    expect(screen.getByText("DATABASE_URL")).toBeInTheDocument();
    expect(screen.getByText("FEATURE_FLAG")).toBeInTheDocument();
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByText("Dockerfile")).toBeInTheDocument();

    expect(document.querySelectorAll('input[type="password"]').length).toBe(2);

    const showButtons = screen.getAllByRole("button", { name: /^Show$/ });
    await user.click(showButtons[0]);
    expect(document.querySelectorAll('input[type="password"]').length).toBe(1);
    expect(document.querySelectorAll('input[type="text"]').length).toBe(1);
    expect(screen.getByRole("button", { name: /^Hide$/ })).toBeInTheDocument();
  });

  it("blocks submit and shows a missing-keys error when required env vars are empty", () => {
    renderInput({
      inputType: "env_vars",
      label: "Env",
      envVarSpec: [
        { key: "DATABASE_URL", required: true },
        { key: "OPTIONAL_FLAG", required: false },
      ],
    });
    expect(screen.getByText(/Required: DATABASE_URL\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit/i })).toBeDisabled();
  });

  it("submits env vars as JSON when required fields are filled", async () => {
    const { onSubmit } = renderInput({
      inputType: "env_vars",
      label: "Env",
      envVarSpec: [
        { key: "DATABASE_URL", required: true, source: "Dockerfile" },
        { key: "FEATURE_FLAG", required: false, defaultValue: "off" },
      ],
    });
    const inputs = document.querySelectorAll(
      ".env-row input",
    ) as NodeListOf<HTMLInputElement>;
    fireEvent.change(inputs[0], { target: { value: "postgres://x" } });
    fireEvent.change(inputs[1], { target: { value: "on" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Submit/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(onSubmit.mock.calls[0][0] as string);
    expect(payload).toEqual({
      envVars: [
        {
          key: "DATABASE_URL",
          value: "postgres://x",
          required: true,
          source: "Dockerfile",
        },
        { key: "FEATURE_FLAG", value: "on", required: false },
      ],
    });
  });

  it("Submit stays enabled for env_vars even when there are no required keys", () => {
    renderInput({
      inputType: "env_vars",
      label: "Env",
      envVarSpec: [{ key: "OPTIONAL", required: false }],
    });
    expect(screen.getByRole("button", { name: /Submit/i })).not.toBeDisabled();
  });
});
