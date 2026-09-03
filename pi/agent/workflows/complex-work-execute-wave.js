const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.plan) {
  throw new Error("No complex-work plan is stored in this mission. Run complex-work-plan.js first.");
}
if (workflowState.pendingIntegration) {
  throw new Error("The previous wave is awaiting integration. Run complex-work-integrate-wave.js before dispatching another wave.");
}
if (workflowState.pendingReview) {
  throw new Error("The previous integrated wave is awaiting review. Run complex-work-review-wave.js or record its disposition first.");
}

const completed = workflowState.completedWaveIds || [];
const nextWave = workflowState.plan.waves.find((wave) => (
  !completed.includes(wave.id) && wave.dependsOn.every((dependency) => completed.includes(dependency))
));
if (!nextWave) {
  return { status: "complete", message: "No dependency-ready execution wave remains.", completedWaveIds: completed };
}

if (nextWave.parallel && nextWave.lanes.length > 1 && nextWave.lanes.some((lane) => lane.isolation !== "worktree")) {
  throw new Error("Parallel writer lanes require Pi-managed worktrees.");
}

function laneTask(lane) {
  const taskRecord = "docs/tasks/" + nextWave.id + "-" + lane.id + ".md";
  return [
    "Own this approved implementation lane. You are a headless lane coordinator, not the integration owner.",
    "Use one focused nested scout, then one nested work-unit. Keep all mutation in the lane checkout.",
    "Ask the parent through contact_supervisor and wait for any cross-lane, architecture, scope, authority, or acceptance decision.",
    "Do not run smoke, manual, or end-to-end smoke tests.",
    "Create and maintain the task record at " + taskRecord + ". It must contain Description, Research summary, Status (todo, started, or finished), acceptance criteria, runnable-state evidence, and blockers. Start it before implementation and mark it finished only when the lane is complete; otherwise leave an accurate todo/started status.",
    "Leave the application runnable at the lane boundary. Run focused automated checks that provide evidence for that claim, and report any gap honestly.",
    "Return the nested work-unit handoff plus the task record path and any blocker.",
    "Lane directive:",
    JSON.stringify({ ...lane, taskRecord })
  ].join("\n");
}

let laneResults;
if (nextWave.parallel && nextWave.lanes.length > 1) {
  laneResults = await runs.all(nextWave.lanes.map((lane) => ({
    key: "lane-" + nextWave.id + "-" + lane.id,
    agent: "lane-coordinator",
    task: laneTask(lane),
    worktree: true,
    output: "lanes/" + nextWave.id + "-" + lane.id + ".md",
    outputMode: "file-only"
  })));
} else {
  laneResults = [];
  for (const lane of nextWave.lanes) {
    laneResults.push(await runs.run("lane-" + nextWave.id + "-" + lane.id, {
      agent: "lane-coordinator",
      task: laneTask(lane),
      worktree: lane.isolation === "worktree",
      output: "lanes/" + nextWave.id + "-" + lane.id + ".md",
      outputMode: "file-only"
    }));
  }
}

const pendingIntegration = {
  wave: nextWave,
  laneResults: laneResults.map((result) => ({
    runId: result.runId,
    ok: result.ok,
    output: result.output,
    artifactPaths: result.artifactPaths
  }))
};
await state.set("complexWork", {
  ...workflowState,
  pendingIntegration
});

return { status: "integration-required", wave: nextWave, laneResults: pendingIntegration.laneResults };