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
