import { env } from "./env.js";
import { buildApp } from "./app.js";
import { sweepStaleClones } from "./tools/cloneRepo.js";
import { spawn } from "node:child_process";

const app = await buildApp();

sweepStaleClones().catch((err) => app.log.warn({ err }, "stale clone sweep failed"));

const gitCheck = spawn("git", ["--version"], { stdio: "ignore" });
gitCheck.on("error", () => app.log.warn("git binary not found — clone_and_inspect_repo tool will fail"));
gitCheck.on("close", (code) => {
  if (code !== 0) app.log.warn({ code }, "git --version returned non-zero");
});

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
