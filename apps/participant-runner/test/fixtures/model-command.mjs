let input = "";
for await (const chunk of process.stdin) input += chunk;
if (process.env.ABL_RUNNER_STORE_B64 || process.env.ABL_RUNNER_STORE_PATH)
  process.exit(23);
if (!input.includes("official context")) process.exit(24);
process.stdout.write('```json\n{"action":"HOLD"}\n```\n');
