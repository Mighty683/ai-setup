const workflowState = await state.get("complexWork");
if (!workflowState?.plan) {
  throw new Error("No complex-work plan is stored in this mission.");
}
if (workflowState.pendingIntegration) {
  throw new Error("The previous execution batch is awaiting integration.");
}
if (workflowState.pendingReview) {
  throw new Error("The previous integrated batch is awaiting review.");
}

const maxParallelLanes = 8;
const completed = workflowState.completedWaveIds || [];
const remainingWaves = workflowState.plan.waves.filter(
  (wave) => !completed.includes(wave.id),
);
const readyWaves = remainingWaves.filter((wave) =>
  wave.dependsOn.every((dependency) => completed.includes(dependency)),
);
if (readyWaves.length === 0) {
  if (remainingWaves.length > 0) {
    throw new Error("No dependency-ready wave remains; the stored plan is blocked or cyclic.");
  }
  return {
    status: "complete",
    message: "No execution wave remains.",
    completedWaveIds: completed,
  };
}

function laneResources(lane) {
  return [...lane.scope, ...lane.claimedFilesOrContracts]
    .map((resource) => resource.trim().replaceAll("\\", "/").toLowerCase())
    .filter((resource) => resource && !resource.startsWith("docs/tasks/"));
}

function waveResources(wave) {
  return [...new Set(wave.lanes.flatMap((lane) => laneResources(lane)))];
}

function assertParallelWaveSafety(wave) {
  if (!wave.parallel || wave.lanes.length < 2) return;
  const owners = new Map();
  for (const lane of wave.lanes) {
    if (lane.isolation !== "worktree") {
      throw new Error("Parallel writer lanes require Pi-managed worktrees: " + wave.id + "/" + lane.id);
    }
    for (const resource of laneResources(lane)) {
      const owner = owners.get(resource);
      if (owner && owner !== lane.id) {
        throw new Error("Parallel lanes claim the same resource: " + wave.id + "/" + owner + " and " + wave.id + "/" + lane.id + " -> " + resource);
      }
      owners.set(resource, lane.id);
    }
  }
}

for (const wave of readyWaves) assertParallelWaveSafety(wave);

const selectedWaves = [];
const selectedResources = new Set();
let selectedLaneCount = 0;
for (const wave of readyWaves) {
  const serialMultiLane = !wave.parallel && wave.lanes.length > 1;
  if (selectedWaves.length > 0 && serialMultiLane) continue;
  if (selectedWaves.length > 0 && selectedLaneCount + wave.lanes.length > maxParallelLanes) continue;
  const resources = waveResources(wave);
  if (selectedWaves.length > 0 && resources.some((resource) => selectedResources.has(resource))) continue;
  selectedWaves.push(wave);
  selectedLaneCount += wave.lanes.length;
  for (const resource of resources) selectedResources.add(resource);
  if (serialMultiLane) break;
}

const laneEntries = selectedWaves.flatMap((wave) =>
  wave.lanes.map((lane) => ({ wave, lane })),
);
const sourceWaveIds = selectedWaves.map((wave) => wave.id);
const batchId = sourceWaveIds.length === 1
  ? sourceWaveIds[0]
  : "batch-" + sourceWaveIds.join("--");
const executionWave = sourceWaveIds.length === 1
  ? { ...selectedWaves[0], sourceWaveIds }
  : {
      id: batchId,
      sourceWaveIds,
      dependsOn: [],
      parallel: true,
      waves: selectedWaves,
      lanes: laneEntries.map(({ wave, lane }) => ({
        ...lane,
        sourceWaveId: wave.id,
        sourceLaneId: lane.id,
      })),
    };

const laneOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["accepted", "blocked"] },
    summary: { type: "string" },
    taskRecord: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" } },
    checks: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
    nestedWriterComplete: { type: "boolean" },
  },
  required: ["status", "summary", "taskRecord", "changedFiles", "checks", "blockers", "nestedWriterComplete"],
  additionalProperties: false,
};

function laneTask(entry) {
  const taskRecord = "docs/tasks/" + entry.wave.id + "-" + entry.lane.id + ".md";
  const scopedFiles = entry.lane.scope.filter((path) => !path.includes("docs/tasks/"));
  const normalizedLane = {
    ...entry.lane,
    waveId: entry.wave.id,
    scope: [...scopedFiles, taskRecord],
    taskRecord,
  };
  const cargoTarget = "/tmp/pi-complex-work-target-" + entry.wave.id + "-" + entry.lane.id;
  return [
    "Own this approved implementation lane. You are a headless lane coordinator, not the integration owner.",
    "Use one focused nested scout, then one nested work-unit. Keep all mutation in this lane checkout.",
    "The nested work-unit must use this lane's current working directory, set worktree: false, and must not target the original repository checkout. There must be exactly one managed worktree for this lane.",
    "Do not pause or detach to ask a supervisor question. Return cross-lane, architecture, scope, authority, or acceptance decisions as blocking handoffs.",
    "Do not run smoke, manual, or end-to-end smoke tests.",
    "Create and maintain the sole task record at " + taskRecord + ". It must contain Description, Research summary, Status, acceptance criteria, runnable-state evidence, and blockers.",
    "When Cargo checks can overlap, prefix them with CARGO_TARGET_DIR=" + cargoTarget + ".",
    "Leave the application runnable at the lane boundary and report focused automated evidence.",
    "Your final action must call the injected structured_output tool exactly once. Return accepted only when the nested writer finished, acceptance is met, checks passed, and no blocker remains.",
    "Lane directive:",
    JSON.stringify(normalizedLane),
  ].join("\n");
}

function laneInvocation(entry) {
  return {
    key: "lane-" + entry.wave.id + "-" + entry.lane.id,
    agent: "lane-coordinator",
    task: laneTask(entry),
    worktree: true,
    output: "lanes/" + entry.wave.id + "-" + entry.lane.id + ".md",
    outputSchema: laneOutputSchema,
  };
}

await state.set("complexWork", {
  ...workflowState,
  activeExecution: {
    batchId,
    waveIds: sourceWaveIds,
    startedAt: new Date().toISOString(),
    status: "running",
  },
});

let laneResults;
try {
  const runConcurrently = laneEntries.length > 1 && (
    selectedWaves.length > 1 || selectedWaves[0].parallel
  );
  if (runConcurrently) {
    laneResults = await runs.all(laneEntries.map((entry) => laneInvocation(entry)));
  } else {
    laneResults = [];
    for (const entry of laneEntries) {
      const invocation = laneInvocation(entry);
      const { key, ...options } = invocation;
      laneResults.push(await runs.run(key, options));
    }
  }
} catch (error) {
  await state.set("complexWork", {
    ...workflowState,
    activeExecution: {
      batchId,
      waveIds: sourceWaveIds,
      status: "failed",
      error: String(error),
    },
  });
  throw error;
}

const normalizedResults = laneResults.map((result, index) => ({
  waveId: laneEntries[index].wave.id,
  laneId: laneEntries[index].lane.id,
  runId: result.runId,
  ok: result.ok,
  output: result.output,
  structuredOutput: result.structuredOutput,
  artifactPaths: result.artifactPaths,
}));
const failedResults = normalizedResults.filter((result) => {
  const expectedTaskRecord = "docs/tasks/" + result.waveId + "-" + result.laneId + ".md";
  return (
    !result.ok ||
    result.structuredOutput?.status !== "accepted" ||
    result.structuredOutput?.nestedWriterComplete !== true ||
    result.structuredOutput?.taskRecord !== expectedTaskRecord ||
    !result.structuredOutput?.changedFiles?.length ||
    !result.structuredOutput?.checks?.length ||
    result.structuredOutput?.blockers?.length > 0
  );
});
if (failedResults.length > 0) {
  await state.set("complexWork", {
    ...workflowState,
    activeExecution: null,
    failedExecution: { wave: executionWave, laneResults: normalizedResults },
  });
  return {
    status: "execution-blocked",
    wave: executionWave,
    laneResults: normalizedResults,
  };
}

const pendingIntegration = {
  wave: executionWave,
  laneResults: normalizedResults,
};
await state.set("complexWork", {
  ...workflowState,
  activeExecution: null,
  failedExecution: null,
  pendingIntegration,
});

return {
  status: "integration-required",
  wave: executionWave,
  waveIds: sourceWaveIds,
  laneResults: normalizedResults,
};
