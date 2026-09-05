import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = new URL("../workflows/", import.meta.url);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

async function loadWorkflow(name) {
  const source = await readFile(new URL(name, workflowDirectory), "utf8");
  return new AsyncFunction("runs", "state", source);
}

function fixturePlan() {
  return {
    waves: [
      {
        id: "wave-1",
        dependsOn: [],
        parallel: false,
        lanes: [
          {
            id: "editor-ui",
            objective: "Implement the editor UI change",
            scope: ["docs/tasks/planner-selected.md", "src/editor-ui.rs"],
            claimedFilesOrContracts: [],
            dependencies: [],
            isolation: "shared",
            acceptanceCriteria: [],
            focusedChecks: [],
            stopConditions: [],
          },
        ],
      },
    ],
  };
}

function fixtureState(overrides = {}) {
  return {
    plan: fixturePlan(),
    completedWaveIds: [],
    pendingIntegration: null,
    pendingReview: null,
    ...overrides,
  };
}

function stateHarness(initialState) {
  let current = initialState;
  const writes = [];
  return {
    state: {
      async get(key) {
        assert.equal(key, "complexWork");
        return current;
      },
      async set(key, value) {
        assert.equal(key, "complexWork");
        current = value;
        writes.push(value);
      },
    },
    current: () => current,
    writes,
  };
}

test("all workflow scripts parse in the workflow async-function environment", async () => {
  const names = (await readdir(workflowDirectory)).filter((name) =>
    name.endsWith(".js"),
  );
  for (const name of names) await loadWorkflow(name);
});

test("execution uses one outer worktree and one canonical task record", async () => {
  const harness = stateHarness(fixtureState());
  let invocation;
  const runs = {
    async run(_key, options) {
      invocation = options;
      return {
        runId: "lane-run",
        ok: true,
        output: "handoff",
        structuredOutput: {
          status: "accepted",
          summary: "implemented",
          taskRecord: "docs/tasks/wave-1-editor-ui.md",
          changedFiles: ["src/editor-ui.rs"],
          checks: ["focused checks passed"],
          blockers: [],
          nestedWriterComplete: true,
        },
        artifactPaths: ["patch"],
      };
    },
    async all() {
      throw new Error("serial fixture must not use runs.all");
    },
  };

  const result = await (await loadWorkflow("complex-work-execute-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "integration-required");
  assert.equal(invocation.worktree, true);
  assert.match(invocation.task, /set worktree: false/);
  assert.match(
    invocation.task,
    /must not target the original repository checkout/,
  );

  const directive = JSON.parse(invocation.task.split("Lane directive:\n")[1]);
  assert.deepEqual(directive.scope, [
    "src/editor-ui.rs",
    "docs/tasks/wave-1-editor-ui.md",
  ]);
  assert.equal(directive.taskRecord, "docs/tasks/wave-1-editor-ui.md");
  assert.ok(harness.current().pendingIntegration);
  assert.equal(harness.current().activeExecution, null);
});

test("independent ready waves are dispatched in one parallel batch", async () => {
  const parallelPlan = {
    waves: [
      {
        id: "wave-a",
        dependsOn: [],
        parallel: false,
        lanes: [
          {
            ...fixturePlan().waves[0].lanes[0],
            id: "lane-a",
            scope: ["src/a.rs"],
            isolation: "worktree",
          },
        ],
      },
      {
        id: "wave-b",
        dependsOn: [],
        parallel: false,
        lanes: [
          {
            ...fixturePlan().waves[0].lanes[0],
            id: "lane-b",
            scope: ["src/b.rs"],
            isolation: "worktree",
          },
        ],
      },
    ],
  };
  const harness = stateHarness(fixtureState({ plan: parallelPlan }));
  let invocations;
  const runs = {
    async all(items) {
      invocations = items;
      return items.map((item) => {
        const taskRecord = item.task.match(/docs\/tasks\/[^ ]+\.md/)[0];
        return {
          runId: item.key,
          ok: true,
          output: "implemented",
          structuredOutput: {
            status: "accepted",
            summary: "implemented",
            taskRecord,
            changedFiles: [taskRecord.replace("docs/tasks/", "src/")],
            checks: ["passed"],
            blockers: [],
            nestedWriterComplete: true,
          },
          artifactPaths: [item.key + ".patch"],
        };
      });
    },
    async run() {
      throw new Error("independent ready waves must use runs.all");
    },
  };

  const result = await (await loadWorkflow("complex-work-execute-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(invocations.length, 2);
  assert.deepEqual(result.wave.sourceWaveIds, ["wave-a", "wave-b"]);
  assert.deepEqual(
    result.laneResults.map(({ waveId }) => waveId),
    ["wave-a", "wave-b"],
  );
  assert.ok(invocations.every(({ worktree }) => worktree));
});

test("resource-conflicting ready waves are serialized", async () => {
  const sharedLane = fixturePlan().waves[0].lanes[0];
  const conflictingPlan = {
    waves: [
      {
        id: "wave-a",
        dependsOn: [],
        parallel: false,
        lanes: [{ ...sharedLane, id: "lane-a", scope: ["src/shared.rs"] }],
      },
      {
        id: "wave-b",
        dependsOn: [],
        parallel: false,
        lanes: [{ ...sharedLane, id: "lane-b", scope: ["src/shared.rs"] }],
      },
    ],
  };
  const harness = stateHarness(fixtureState({ plan: conflictingPlan }));
  const runs = {
    async run(_key, options) {
      const taskRecord = options.task.match(/docs\/tasks\/[^ ]+\.md/)[0];
      return {
        runId: "one-lane",
        ok: true,
        output: "implemented",
        structuredOutput: {
          status: "accepted",
          summary: "implemented",
          taskRecord,
          changedFiles: ["src/shared.rs"],
          checks: ["passed"],
          blockers: [],
          nestedWriterComplete: true,
        },
      };
    },
    async all() {
      throw new Error("conflicting waves must not run concurrently");
    },
  };

  const result = await (await loadWorkflow("complex-work-execute-wave.js"))(
    runs,
    harness.state,
  );
  assert.deepEqual(result.wave.sourceWaveIds, ["wave-a"]);
});

test("failed lane results cannot become integration candidates", async () => {
  const harness = stateHarness(fixtureState());
  const runs = {
    async run() {
      return {
        runId: "failed-lane",
        ok: false,
        output: "blocked",
        artifactPaths: [],
      };
    },
    async all() {
      throw new Error("serial fixture must not use runs.all");
    },
  };

  const result = await (await loadWorkflow("complex-work-execute-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "execution-blocked");
  assert.equal(harness.current().pendingIntegration, null);
  assert.equal(harness.current().failedExecution.laneResults[0].ok, false);
});

test("semantically blocked lane cannot become an integration candidate", async () => {
  const harness = stateHarness(fixtureState());
  const runs = {
    async run() {
      return {
        runId: "completed-but-blocked",
        ok: true,
        output: "process completed",
        structuredOutput: {
          status: "blocked",
          summary: "nested writer is still active",
          taskRecord: "docs/tasks/wave-1-editor-ui.md",
          changedFiles: ["src/editor-ui.rs"],
          checks: [],
          blockers: ["nested writer incomplete"],
          nestedWriterComplete: false,
        },
        artifactPaths: ["partial.patch"],
      };
    },
    async all() {
      throw new Error("serial fixture must not use runs.all");
    },
  };

  const result = await (await loadWorkflow("complex-work-execute-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "execution-blocked");
  assert.equal(harness.current().pendingIntegration, null);
});

test("integration prose cannot override a structured blocked result", async () => {
  const harness = stateHarness(
    fixtureState({
      pendingIntegration: {
        wave: fixturePlan().waves[0],
        laneResults: [],
      },
    }),
  );
  const runs = {
    async run() {
      return {
        runId: "integration-run",
        ok: true,
        output: "Everything completed",
        structuredOutput: {
          status: "blocked",
          summary: "no candidate was applied",
          appliedArtifacts: [],
          changedFiles: [],
          taskRecords: [],
          checks: [],
          blockers: ["missing patch"],
        },
      };
    },
  };

  const result = await (await loadWorkflow("complex-work-integrate-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "integration-failed");
  assert.equal(harness.current().pendingReview, null);
  assert.equal(
    harness.current().failedIntegration.structuredOutput.status,
    "blocked",
  );
});

test("blocking review returns a user decision gate", async () => {
  const harness = stateHarness(
    fixtureState({
      pendingReview: {
        wave: fixturePlan().waves[0],
        integration: { output: "integrated" },
      },
    }),
  );
  const runs = {
    async all(invocations) {
      assert.equal(invocations.length, 3);
      return invocations.map((_, index) => ({
        runId: `review-${index}`,
        ok: true,
        output: "review completed",
        structuredOutput: {
          verdict: index === 0 ? "block" : "pass",
          findings:
            index === 0
              ? [
                  {
                    severity: "P1",
                    summary: "design decision required",
                    evidence: "src/editor-ui.rs:10",
                    solutionKnown: false,
                    suggestedCorrection: "return to planning",
                  },
                ]
              : [],
          validation: [],
          residualGaps: [],
        },
      }));
    },
  };

  const result = await (await loadWorkflow("complex-work-review-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "review-decision-required");
  assert.equal(
    harness.current().pendingReview.reviewVerdict,
    "decision-required",
  );
});

test("contradictory passing review with unresolved finding requires a user decision", async () => {
  const harness = stateHarness(
    fixtureState({
      pendingReview: {
        wave: fixturePlan().waves[0],
        integration: { output: "integrated" },
      },
    }),
  );
  const runs = {
    async all(invocations) {
      return invocations.map((_, index) => ({
        runId: `review-${index}`,
        ok: true,
        structuredOutput: {
          verdict: "pass",
          findings:
            index === 0
              ? [
                  {
                    severity: "P1",
                    summary: "unresolved architecture choice",
                    evidence: "src/editor-ui.rs:20",
                    solutionKnown: false,
                    suggestedCorrection: "ask the user",
                  },
                ]
              : [],
          validation: [],
          residualGaps: [],
        },
      }));
    },
  };

  const result = await (await loadWorkflow("complex-work-review-wave.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "review-decision-required");
});

test("planning compatibility wrapper requires persisted research", async () => {
  const harness = stateHarness(fixtureState({ researchBrief: undefined }));
  await assert.rejects(
    (await loadWorkflow("complex-work-plan.js"))(
      { async run() {} },
      harness.state,
    ),
    /authoritative research brief/,
  );
});

test("planning compatibility wrapper returns ordinary Markdown", async () => {
  const harness = stateHarness(
    fixtureState({
      researchBrief: {
        summary: "researched",
        evidence: ["src/editor-ui.rs"],
        constraints: ["preserve behavior"],
        unresolvedDecisions: [],
      },
    }),
  );
  let invocation;
  const runs = {
    async run(_key, options) {
      invocation = options;
      return {
        ok: true,
        output: "# Plan\n\nOne serial wave.",
        runId: "plan-run",
      };
    },
  };

  const result = await (await loadWorkflow("complex-work-plan.js"))(
    runs,
    harness.state,
  );

  assert.equal(result.status, "plan-draft");
  assert.equal(result.planMarkdown, "# Plan\n\nOne serial wave.");
  assert.equal(invocation.outputSchema, undefined);
  assert.match(invocation.task, /Authoritative research brief/);
  assert.equal(harness.writes.length, 0);
});

test("planning compatibility wrapper includes correction evidence", async () => {
  const harness = stateHarness(
    fixtureState({
      researchBrief: {
        summary: "researched",
        evidence: ["src/editor-ui.rs"],
        constraints: [],
        unresolvedDecisions: [],
      },
      failedIntegration: { blockers: ["must redesign branch ownership"] },
    }),
  );
  let plannerTask = "";
  const runs = {
    async run(_key, options) {
      plannerTask = options.task;
      return { ok: true, output: "corrected plan", runId: "plan-run" };
    },
  };

  await (await loadWorkflow("complex-work-plan.js"))(runs, harness.state);
  assert.match(plannerTask, /must redesign branch ownership/);
});

test("verification and closure complete every source wave in a batch", async () => {
  const batchWave = {
    id: "batch-wave-a--wave-b",
    sourceWaveIds: ["wave-a", "wave-b"],
  };
  const harness = stateHarness(
    fixtureState({
      pendingReview: {
        wave: batchWave,
        reviewFindings: [],
        reviewVerdict: "passed",
      },
    }),
  );

  const verification = await (
    await loadWorkflow("complex-work-verify-wave.js")
  )({}, harness.state);
  assert.deepEqual(verification.waveIds, ["wave-a", "wave-b"]);
  const closure = await (
    await loadWorkflow("complex-work-close-wave.js")
  )({}, harness.state);
  assert.deepEqual(closure.completedWaveIds, ["wave-a", "wave-b"]);
  assert.deepEqual(harness.current().completedWaveIds, ["wave-a", "wave-b"]);
});

test("thrown lane failures leave a durable failed execution checkpoint", async () => {
  const harness = stateHarness(fixtureState());
  const runs = {
    async run() {
      throw new Error("lane crashed");
    },
    async all() {
      throw new Error("serial fixture must not use runs.all");
    },
  };

  await assert.rejects(
    (await loadWorkflow("complex-work-execute-wave.js"))(runs, harness.state),
    /lane crashed/,
  );
  assert.equal(harness.current().activeExecution.status, "failed");
  assert.match(harness.current().activeExecution.error, /lane crashed/);
});
