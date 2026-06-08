// Hand-maintained mirror of WireWorkflowState from backend/src/chat/workflowGate.ts.
// Keep in sync when the backend wire shape changes.
export type WireWorkflowState = {
  reviewer: { open: true; ready: boolean; nameGuess: string | null };
  coordinator: {
    open: boolean;
    collected: boolean;
    appName: string | null;
    envVarKeys: string[];
    envVars: { key: string; maskedValue: string }[];
  };
  deployer: {
    open: boolean;
    buildPack: string | null;
    targetUrl: string | null;
  };
};
