import { runCareerRuntime } from "./career-runtime.js";
import { runPossessionRuntime } from "./possession-runtime.js";

if (process.env.ABL_BODY_RUNTIME_MODE === "FOUNDING_CAREER")
  await runCareerRuntime();
else await runPossessionRuntime();
