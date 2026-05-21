"use client";

import { useState } from "react";

export type InputTypeId =
  | "text"
  | "github_url"
  | "url"
  | "email"
  | "number"
  | "color"
  | "date"
  | "file"
  | "password"
  | "select"
  | "env_vars";

export interface EnvVarSpec {
  key: string;
  required: boolean;
  source?: string;
  defaultValue?: string;
}

export interface InputRequest {
  inputType: InputTypeId;
  label: string;
  fieldName?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
  envVarSpec?: EnvVarSpec[];
  toolCallId: string;
}

interface Props {
  request: InputRequest;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

function isValidGitHubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

export default function DynamicInput({ request, onSubmit, disabled = false }: Props) {
  const [value, setValue] = useState(
    request.inputType === "color"
      ? request.defaultValue || "#000000"
      : request.defaultValue ?? "",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [fileError, setFileError] = useState("");
  const [envValues, setEnvValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of request.envVarSpec ?? []) init[v.key] = v.defaultValue ?? "";
    return init;
  });
  const [envVisible, setEnvVisible] = useState<Record<string, boolean>>({});

  const MAX_FILE_SIZE = 1024 * 1024;

  function getEnvValidationError(): string {
    const missing = (request.envVarSpec ?? [])
      .filter((v) => v.required && !envValues[v.key]?.trim())
      .map((v) => v.key);
    if (missing.length) return `Required: ${missing.join(", ")}.`;
    return "";
  }

  function getValidationError(): string {
    if (request.inputType === "env_vars") return getEnvValidationError();
    if (!value && request.required) return "Required.";
    if (request.inputType === "github_url" && value && !isValidGitHubUrl(value)) {
      return "Must be a valid github.com/owner/repo URL.";
    }
    return "";
  }

  const validationError = getValidationError();
  const canSubmit =
    !disabled &&
    !validationError &&
    (request.inputType === "env_vars"
      ? true
      : request.required
      ? !!value
      : true);

  async function handleFileSubmit(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      onSubmit(`[File: ${file.name}, ${file.size} bytes — too large to send]`);
      return;
    }
    const text = await file.text();
    onSubmit(text);
  }

  function handleSubmit() {
    if (!canSubmit) return;
    if (request.inputType === "file") return; // handled by file input change
    if (request.inputType === "env_vars") {
      const envVars = (request.envVarSpec ?? []).map((v) => ({
        key: v.key,
        value: envValues[v.key] ?? "",
        required: v.required,
        ...(v.source ? { source: v.source } : {}),
      }));
      onSubmit(JSON.stringify({ envVars }));
      return;
    }
    onSubmit(value);
  }

  function renderInput() {
    switch (request.inputType) {
      case "github_url":
        return (
          <div className="row">
            <span className="gh-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-label="GitHub">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </span>
            <input
              type="url"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={request.placeholder ?? "https://github.com/owner/repo"}
              className="input"
              disabled={disabled}
              autoFocus
            />
          </div>
        );

      case "url":
        return (
          <input
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={request.placeholder ?? "https://"}
            className="input"
            disabled={disabled}
            autoFocus
          />
        );

      case "email":
        return (
          <input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={request.placeholder ?? "you@example.com"}
            className="input"
            disabled={disabled}
            autoFocus
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={request.placeholder}
            className="input"
            disabled={disabled}
            autoFocus
          />
        );

      case "color":
        return (
          <div className="row-wide">
            <input
              type="color"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="input-color"
              disabled={disabled}
              autoFocus
            />
            <span className="color-value">{value}</span>
          </div>
        );

      case "date":
        return (
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input input-date"
            disabled={disabled}
            autoFocus
          />
        );

      case "file":
        return (
          <div>
            <input
              type="file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileError("");
                await handleFileSubmit(file);
              }}
              className="input-file"
              disabled={disabled}
            />
            {fileError && <div className="error-text">{fileError}</div>}
          </div>
        );

      case "password":
        return (
          <div className="row">
            <input
              type={showPassword ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder={request.placeholder ?? "Enter password..."}
              className="input"
              disabled={disabled}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="btn-toggle-pw"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        );

      case "select":
        return (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input"
            disabled={disabled}
            autoFocus
          >
            <option value="">— choose —</option>
            {(request.options ?? []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );

      case "env_vars": {
        const spec = request.envVarSpec ?? [];
        if (spec.length === 0) {
          return <div className="env-empty">No environment variables detected.</div>;
        }
        return (
          <div className="env-list">
            {spec.map((v) => {
              const visible = envVisible[v.key];
              return (
                <div key={v.key} className="env-row">
                  <div className="env-key">
                    <code>{v.key}</code>
                    {v.required && <span className="env-required">required</span>}
                    {v.source && <span className="env-source" title={v.source}>{v.source}</span>}
                  </div>
                  <div className="env-value-row">
                    <input
                      type={visible ? "text" : "password"}
                      value={envValues[v.key] ?? ""}
                      onChange={(e) => setEnvValues((s) => ({ ...s, [v.key]: e.target.value }))}
                      placeholder={v.defaultValue ?? ""}
                      className="input"
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      onClick={() => setEnvVisible((s) => ({ ...s, [v.key]: !visible }))}
                      className="btn-toggle-pw"
                    >
                      {visible ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={request.placeholder ?? "Type your answer..."}
            className="input"
            disabled={disabled}
            autoFocus
          />
        );
    }
  }

  const showSubmitButton = request.inputType !== "file";

  return (
    <div className="dyn-input">
      <div className="dyn-input-inner">
        <div className="dyn-input-card">
          <label className="label">{request.label}</label>
          <div className="dyn-input-row">
            <div className="dyn-input-grow">{renderInput()}</div>
            {showSubmitButton && (
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="btn btn-primary"
              >
                Submit
              </button>
            )}
          </div>
          {validationError && (value || request.inputType === "env_vars") && (
            <div className="error-text">{validationError}</div>
          )}
        </div>
      </div>
    </div>
  );
}
