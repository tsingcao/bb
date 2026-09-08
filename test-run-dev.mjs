import runBbDev from "./.bb/skills/run-bb-dev/skill.ts";

console.log(">>> calling runBbDev");
const r = await runBbDev({ runId: "nextloop-dev" });
console.log(">>> result:", JSON.stringify(r, null, 2));