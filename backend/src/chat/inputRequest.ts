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

export interface InputRequestParams {
  inputType: InputTypeId;
  label: string;
  fieldName?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  required?: boolean;
  envVarSpec?: EnvVarSpec[];
}
