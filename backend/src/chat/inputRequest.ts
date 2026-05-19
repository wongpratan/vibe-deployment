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
  | "select";

export interface InputRequestParams {
  inputType: InputTypeId;
  label: string;
  fieldName?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
}
