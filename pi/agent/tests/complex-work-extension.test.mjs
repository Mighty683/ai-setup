import assert from "node:assert/strict";
import test from "node:test";

process.env.PI_SOUND_DISABLED = "1";
const {
  buildPhaseHistory,
  default: complexWorkExtension,
  formatComplexWorkStatus,
  replayComplexWorkStates,
} = await import("../extensions/complex-work.ts");

const researchBrief = {
  summary: "Research-first orchestration",
  evidence: ["pi/agent/extensions/complex-work.ts"],
  constraints: ["Keep user GO gate"],
  unresolvedDecisions: [],
  resolvedDecisions: [],
};

const plan = {
  objective: "Implement the approved change",
  nonGoals: ["Unrelated cleanup"],
  constraints: ["Keep the app runnable"],
  acceptanceCriteria: ["Focused tests pass"],
  userDecisions: [],
  reviewResponse: [],
  waves: [
    {
      id: "wave-1",
      dependsOn: [],
      parallel: false,
      lanes: [
        {
          id: "lane-1",
          objective:
            "MODEL: openai-codex/gpt-5.6-terra; RATIONALE: integration-sensitive change",
          scope: ["pi/agent/extensions/complex-work.ts"],
          claimedFilesOrContracts: ["complex-work lifecycle"],
          dependencies: [],
          isolation: "shared",
          acceptanceCriteria: ["Focused tests pass"],
          focusedChecks: ["node --test"],
          stopConditions: ["Stop on an unresolved product decision"],
        },
      ],
    },
  ],
};

function markdownWithJson(value, heading = "Draft") {
  return `# ${heading}\n\nAuditable prose.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

async function settle() {
  for (let count = 0; count < 4; count += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function extensionHarness() {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const entries = [];
  const messages = [];
  const rpcLaunches = [];
  const eventHandlers = new Map();
  let activeTools = ["subagent"];
  let nextRun = 1;

  const events = {
    on(event, handler) {
      const registered = eventHandlers.get(event) ?? new Set();
      registered.add(handler);
      eventHandlers.set(event, registered);
      return () => registered.delete(handler);
    },
    emit(event, payload) {
      if (event === "subagents:rpc:v1:request") {
        rpcLaunches.push(payload);
        const runId = `run-${nextRun++}`;
        const missionId =
          payload.params?.missionId ??
          (payload.params?.mission ? "mission-one" : undefined);
        queueMicrotask(() =>
          events.emit(`subagents:rpc:v1:reply:${payload.requestId}`, {
            version: 1,
            requestId: payload.requestId,
            method: payload.method,
            success: true,
            data: {
              text: `${payload.method} accepted`,
              details: {
                runId,
                asyncId: runId,
                ...(missionId ? { missionId } : {}),
              },
            },
          }),
        );
        return;
      }
      for (const handler of eventHandlers.get(event) ?? []) handler(payload);
    },
  };

  const pi = {
    events,
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data: structuredClone(data) });
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names) {
      activeTools = [...names];
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
    setSessionName() {},
  };

  complexWorkExtension(pi);
  return {
    commands,
    entries,
    events,
    handlers,
    messages,
    rpcLaunches,
    tools,
  };
}

function commandContext(overrides = {}) {
  return {
    cwd: "/tmp/project",
    mode: "print",
    sessionManager: {
      getSessionFile: () => "/tmp/complex-work-session.jsonl",
      getBranch: () => [],
    },
    ui: { notify() {} },
    ...overrides,
  };
}

async function currentState(control) {
  return (await control.execute("status", { action: "status" })).details.state;
}

async function startResearch(harness, request = "hybrid workflow") {
  await harness.commands.get("complex-work").handler(request, commandContext());
  return harness.tools.get("complex_work_control");
}

async function completeResearch(harness, control, brief = researchBrief) {
  const researchState = await currentState(control);
  assert.equal(researchState.activeRun.kind, "research");
  harness.events.emit("subagent:async-complete", {
    runId: researchState.activeRun.runId,
    success: true,
    state: "complete",
    workflow: {
      value: {
        status: "research-draft",
        reports: [
          { ok: true, output: "architecture evidence" },
          { ok: true, output: "validation evidence" },
        ],
        synthesisMarkdown: markdownWithJson(brief, "Research brief"),
      },
    },
  });
  await settle();
}

async function completePlan(harness, control, submittedPlan = plan) {
  const plannerState = await currentState(control);
  assert.equal(plannerState.activeRun.kind, "plan");
  harness.events.emit("subagent:async-complete", {
    runId: plannerState.activeRun.runId,
    success: true,
    state: "complete",
    results: [
      { output: markdownWithJson(submittedPlan, "Implementation plan") },
    ],
  });
  await settle();
}

async function finishPlanSeed(harness, control) {
  const seedState = await currentState(control);
  assert.equal(seedState.activeRun.kind, "seed-plan");
  harness.events.emit("subagent:async-complete", {
    runId: seedState.activeRun.runId,
    success: true,
    state: "complete",
    workflow: { value: { status: "plan-stored" } },
  });
  await settle();
}

async function prepareAwaitingGo(harness) {
  const control = await startResearch(harness);
  await completeResearch(harness, control);
  await completePlan(harness, control);
  await finishPlanSeed(harness, control);
  return control;
}

test("complex-work immediately launches parallel research and synthesis", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  const state = await currentState(control);
  const launch = harness.rpcLaunches[0];

  assert.equal(state.phase, "researching");
  assert.equal(state.projectCwd, "/tmp/project");
  assert.equal(state.activeRun.kind, "research");
  assert.equal(launch.method, "spawn");
  assert.match(launch.params.workflowScript, /runs\.all\(scoutTasks\)/);
  assert.equal(
    [...launch.params.workflowScript.matchAll(/agent: "scout"/g)].length,
    4,
  );
  assert.match(launch.params.workflowScript, /agent: "research-synthesis"/);
  assert.equal(harness.messages.length, 0);
});

test("valid research automatically launches registered plan-unit", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  await completeResearch(harness, control);

  const state = await currentState(control);
  const plannerLaunch = harness.rpcLaunches.at(-1);
  assert.equal(state.phase, "planning");
  assert.equal(state.activeRun.kind, "plan");
  assert.deepEqual(state.researchBrief, researchBrief);
  assert.equal(plannerLaunch.params.agent, "plan-unit");
  assert.equal(plannerLaunch.params.workflowScriptPath, undefined);
  assert.equal(plannerLaunch.params.outputSchema, undefined);
  assert.match(plannerLaunch.params.task, /Maximize safe parallel lanes/);
});

test("research decisions pause automation until the user resolves them", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  await completeResearch(harness, control, {
    ...researchBrief,
    unresolvedDecisions: ["Keep backward compatibility or break the API?"],
  });

  let state = await currentState(control);
  assert.equal(state.phase, "awaiting-research-decision");
  assert.equal(state.activeRun, undefined);
  assert.match(harness.messages.at(-1).message.content, /user authority/);

  await control.execute("resolve", {
    action: "resolve-research",
    decisions: ["Preserve backward compatibility."],
  });
  state = await currentState(control);
  assert.equal(state.phase, "planning");
  assert.deepEqual(state.researchBrief.unresolvedDecisions, []);
  assert.deepEqual(state.researchBrief.resolvedDecisions, [
    "Preserve backward compatibility.",
  ]);
  assert.equal(state.activeRun.kind, "plan");
});

test("valid planner Markdown is compiled and mission state is seeded automatically", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  await completeResearch(harness, control);
  await completePlan(harness, control);

  const state = await currentState(control);
  const seed = harness.rpcLaunches.at(-1);
  assert.equal(state.activeRun.kind, "seed-plan");
  assert.deepEqual(state.plan, plan);
  assert.equal(seed.params.workflowScriptPath, undefined);
  assert.match(seed.params.workflowScript, /state\.set/);

  await finishPlanSeed(harness, control);
  const waitingState = await currentState(control);
  assert.equal(waitingState.phase, "awaiting-go");
  assert.equal(waitingState.missionId, "mission-one");
  assert.match(harness.messages.at(-1).message.content, /explicit user GO/);
});

test("invalid planner output is repaired automatically and remains ordinary Markdown", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  await completeResearch(harness, control);
  const invalidPlan = structuredClone(plan);
  invalidPlan.waves[0].dependsOn = ["missing-wave"];

  await completePlan(harness, control, invalidPlan);
  const state = await currentState(control);
  const retryLaunch = harness.rpcLaunches.at(-1);
  assert.equal(state.phase, "planning");
  assert.equal(state.activeRun.kind, "plan");
  assert.equal(state.planningAttempts, 2);
  assert.equal(retryLaunch.params.outputSchema, undefined);
  assert.match(retryLaunch.params.task, /unknown wave missing-wave/);
  assert.match(retryLaunch.params.task, /Prior invalid draft/);
});

test("duplicate completion events cannot advance a replacement run", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  const researchRunId = (await currentState(control)).activeRun.runId;
  await completeResearch(harness, control);
  const plannerRunId = (await currentState(control)).activeRun.runId;

  harness.events.emit("subagent:async-complete", {
    runId: researchRunId,
    success: true,
    state: "complete",
    workflow: { value: { status: "research-draft" } },
  });
  await settle();

  assert.equal((await currentState(control)).activeRun.runId, plannerRunId);
});

test("GO launches execution and successful phases advance automatically", async () => {
  const harness = extensionHarness();
  const control = await prepareAwaitingGo(harness);

  await control.execute("go", { action: "go" });
  let state = await currentState(control);
  assert.equal(state.phase, "executing");
  assert.match(
    harness.rpcLaunches.at(-1).params.workflowScriptPath,
    /execute-wave/,
  );

  harness.events.emit("subagent:async-complete", {
    runId: state.activeRun.runId,
    success: true,
    state: "complete",
    workflow: { value: { status: "integration-required" } },
  });
  await settle();
  state = await currentState(control);
  assert.equal(state.phase, "integrating");

  harness.events.emit("subagent:async-complete", {
    runId: state.activeRun.runId,
    success: true,
    state: "complete",
    workflow: { value: { status: "review-required" } },
  });
  await settle();
  state = await currentState(control);
  assert.equal(state.phase, "reviewing");

  harness.events.emit("subagent:async-complete", {
    runId: state.activeRun.runId,
    success: true,
    state: "complete",
    workflow: { value: { status: "review-passed" } },
  });
  await settle();
  state = await currentState(control);
  assert.equal(state.phase, "verifying");
  assert.equal(state.activeRun, undefined);
});

test("integration rejection records a retryable replan gate", async () => {
  const harness = extensionHarness();
  const control = await prepareAwaitingGo(harness);
  await control.execute("go", { action: "go" });
  let state = await currentState(control);
  harness.events.emit("subagent:async-complete", {
    runId: state.activeRun.runId,
    success: true,
    state: "complete",
    workflow: { value: { status: "integration-required" } },
  });
  await settle();
  state = await currentState(control);
  harness.events.emit("subagent:async-complete", {
    runId: state.activeRun.runId,
    success: true,
    state: "complete",
    workflow: {
      value: { status: "integration-failed", blockers: ["contract mismatch"] },
    },
  });
  await settle();
  state = await currentState(control);

  assert.equal(state.phase, "awaiting-integration-correction");
  assert.match(state.lastFailure.evidence, /contract mismatch/);
  await control.execute("replan", { action: "replan" });
  state = await currentState(control);
  assert.equal(state.phase, "planning");
  assert.equal(state.activeRun.kind, "plan");
});

test("plan-complete recovery override enforces dependency semantics", async () => {
  const harness = extensionHarness();
  const control = await startResearch(harness);
  await completeResearch(harness, control);
  const plannerState = await currentState(control);
  harness.events.emit("subagent:async-complete", {
    runId: plannerState.activeRun.runId,
    success: false,
    state: "failed",
    error: "planner unavailable",
  });
  await settle();
  const invalidPlan = structuredClone(plan);
  invalidPlan.waves[0].dependsOn = ["unknown"];

  await assert.rejects(
    control.execute("override", { action: "plan-complete", plan: invalidPlan }),
    /unknown wave unknown/,
  );
});

test("direct model-facing workflow paths are blocked", async () => {
  const harness = extensionHarness();
  await startResearch(harness);
  const blocked = harness.handlers.get("tool_call")({
    toolName: "subagent",
    input: { workflowScriptPath: "/tmp/workflow.js" },
  });
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /controller-owned/);
});

test("replay follows branch order and coalesces durations", () => {
  const entries = [
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "clock rollback",
        phase: "researching",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    },
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "clock rollback",
        phase: "planning",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    },
  ];
  const states = replayComplexWorkStates(entries);
  const history = buildPhaseHistory(states);

  assert.deepEqual(
    states.map(({ phase }) => phase),
    ["researching", "planning"],
  );
  assert.equal(states.at(-1).phase, "planning");
  assert.match(
    formatComplexWorkStatus(states.at(-1), history),
    /researching: 0s/,
  );
});

test("status opens a TUI overlay and rejects child sessions", async () => {
  const harness = extensionHarness();
  const branch = [
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "status popup",
        phase: "researching",
        rootSessionFile: "/tmp/complex-work-session.jsonl",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    },
  ];
  let component;
  let overlayOptions;
  const notifications = [];
  const context = commandContext({
    mode: "tui",
    sessionManager: {
      getSessionFile: () => "/tmp/complex-work-session.jsonl",
      getBranch: () => branch,
    },
    ui: {
      notify: (...args) => notifications.push(args),
      custom(factory, options) {
        overlayOptions = options;
        component = factory({ requestRender() {} }, {}, {}, () => {
          component = undefined;
        });
        return Promise.resolve();
      },
    },
  });
  harness.handlers.get("session_start")({}, context);
  await harness.commands.get("complex-work-status").handler("", context);
  assert.equal(overlayOptions.overlay, true);
  assert.match(component.render(40).join("\n"), /Current phase: researching/);
  component.handleInput("\r");
  assert.equal(component, undefined);

  const childContext = commandContext({
    mode: "print",
    sessionManager: {
      getSessionFile: () => "/tmp/child.jsonl",
      getBranch: () => branch,
    },
    ui: { notify: (...args) => notifications.push(args) },
  });
  harness.handlers.get("session_start")({}, childContext);
  await harness.commands.get("complex-work-status").handler("", childContext);
  assert.match(notifications.at(-1)[0], /No active complex-work session/);
});
