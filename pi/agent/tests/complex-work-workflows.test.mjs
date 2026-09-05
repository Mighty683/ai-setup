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

test("blocked review without findings synthesizes evidence that replanning must address", async () => {
  const harness = stateHarness(
    fixtureState({
      pendingReview: {
        wave: fixturePlan().waves[0],
        integration: { output: "integrated" },
      },
    }),
  );
  const reviewRuns = {
    async all(invocations) {
      return invocations.map((_, index) => ({
        runId: `empty-block-${index}`,
        ok: true,
        structuredOutput: {
          verdict: index === 0 ? "block" : "pass",
          findings: [],
          validation: [],
          residualGaps: [],
        },
      }));
    },
  };
  await (await loadWorkflow("complex-work-review-wave.js"))(
    reviewRuns,
    harness.state,
  );

  const syntheticSummary =
    harness.current().pendingReview.reviewFindings[0].structuredOutput
      .findings[0].summary;
  assert.match(
    syntheticSummary,
    /did not produce an approvable finding report/,
  );

  const planRuns = {
    async run() {
      return {
        ok: true,
        structuredOutput: { ...fixturePlan(), reviewResponse: [] },
      };
    },
  };
  await assert.rejects(
    (await loadWorkflow("complex-work-plan.js"))(planRuns, harness.state),
    /did not produce an approvable finding report/,
  );
});

test("replanning preserves completed waves and includes review evidence", async () => {
  const blockingFinding = {
    severity: "P1",
    summary: "reviewed layout is unsafe",
    evidence: "src/editor-ui.rs:10",
    solutionKnown: false,
    suggestedCorrection: "revise the layout plan",
  };
  const prior = fixtureState({
    completedWaveIds: ["already-done"],
    planRevision: 2,
    pendingReview: {
      wave: fixturePlan().waves[0],
      reviewVerdict: "decision-required",
      reviewFindings: [
        {
          structuredOutput: { verdict: "block", findings: [blockingFinding] },
        },
      ],
    },
  });
  const harness = stateHarness(prior);
  let plannerTask = "";
  const replacementPlan = {
    ...fixturePlan(),
    reviewResponse: [
      {
        finding: blockingFinding.summary,
        addressedByWaveIds: ["wave-1"],
        rationale: "replacement wave addresses the rejected design",
      },
    ],
  };
  const runs = {
    async run(_key, options) {
      plannerTask = options.task;
      return { ok: true, structuredOutput: replacementPlan };
    },
  };

  await (await loadWorkflow("complex-work-plan.js"))(runs, harness.state);

  assert.match(plannerTask, /replanning cycle/);
  assert.match(plannerTask, /decision-required/);
  assert.deepEqual(harness.current().completedWaveIds, ["already-done"]);
  assert.equal(harness.current().planRevision, 3);
  assert.equal(harness.current().pendingReview, null);
  assert.equal(harness.current().reviewHistory.length, 1);
});

test("replanning rejects a plan that discards blocking review findings", async () => {
  const prior = fixtureState({
    pendingReview: {
      wave: fixturePlan().waves[0],
      reviewVerdict: "decision-required",
      reviewFindings: [
        {
          structuredOutput: {
            verdict: "block",
            findings: [
              {
                severity: "P1",
                summary: "must redesign branch ownership",
                evidence: "src/editor-ui.rs:30",
                solutionKnown: false,
                suggestedCorrection: "replan",
              },
            ],
          },
        },
      ],
    },
  });
  const harness = stateHarness(prior);
  const runs = {
    async run() {
      return {
        ok: true,
        structuredOutput: { ...fixturePlan(), reviewResponse: [] },
      };
    },
  };

  await assert.rejects(
    (await loadWorkflow("complex-work-plan.js"))(runs, harness.state),
    /must redesign branch ownership/,
  );
  assert.equal(
    harness.current().pendingReview.reviewVerdict,
    "decision-required",
  );
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
