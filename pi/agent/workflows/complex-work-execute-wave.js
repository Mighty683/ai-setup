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
  const scopedFiles = lane.scope.filter((path) => !path.includes("docs/tasks/"));
  const normalizedLane = { ...lane, scope: [...scopedFiles, taskRecord], taskRecord };
  const cargoTarget = "/tmp/pi-complex-work-target-" + nextWave.id + "-" + lane.id;
  return [
    "Own this approved implementation lane. You are a headless lane coordinator, not the integration owner.",
    "Use one focused nested scout, then one nested work-unit. Keep all mutation in this lane checkout.",
    "The nested work-unit must use this lane's current working directory, set worktree: false, and must not target the original repository checkout. There must be exactly one managed worktree for this lane.",
    "Do not pause or detach this workflow to ask a supervisor question. Return any cross-lane, architecture, scope, authority, or acceptance decision as a blocking handoff for the root coordinator.",
    "Do not run smoke, manual, or end-to-end smoke tests.",
    "Create and maintain the sole task record at " + taskRecord + ". Ignore any task-record filename embedded in planning prose. It must contain Description, Research summary, Status (todo, started, or finished), acceptance criteria, runnable-state evidence, and blockers. Start it before implementation and mark it finished only when the lane is complete; otherwise leave an accurate todo/started status.",
    "When Cargo checks can overlap another lane, prefix them with CARGO_TARGET_DIR=" + cargoTarget + " to avoid shared build-lock contention.",
    "Leave the application runnable at the lane boundary. Run focused automated checks that provide evidence for that claim, and report any gap honestly.",
    "Return the nested work-unit handoff plus the task record path and any blocker.",
    "Lane directive:",
    JSON.stringify(normalizedLane)
  ].join("\n");
}

await state.set("complexWork", {
  ...workflowState,
  activeExecution: {
    waveId: nextWave.id,
    startedAt: new Date().toISOString(),
    status: "running"
  }
});

let laneResults;
try {
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
        worktree: true,
        output: "lanes/" + nextWave.id + "-" + lane.id + ".md",
        outputMode: "file-only"
      }));
    }
  }
} catch (error) {
  await state.set("complexWork", {
    ...workflowState,
    activeExecution: {
      waveId: nextWave.id,
      status: "failed",
      error: String(error)
    }
  });
  throw error;
}

const normalizedResults = laneResults.map((result) => ({
  runId: result.runId,
  ok: result.ok,
  output: result.output,
  artifactPaths: result.artifactPaths
}));
const failedResults = normalizedResults.filter((result) => !result.ok);
if (failedResults.length > 0) {
  await state.set("complexWork", {
    ...workflowState,
    activeExecution: null,
    failedExecution: { wave: nextWave, laneResults: normalizedResults }
  });
  return { status: "execution-blocked", wave: nextWave, laneResults: normalizedResults };
}

const pendingIntegration = { wave: nextWave, laneResults: normalizedResults };
await state.set("complexWork", {
  ...workflowState,
  activeExecution: null,
  failedExecution: null,
  pendingIntegration
});

return { status: "integration-required", wave: nextWave, laneResults: pendingIntegration.laneResults };