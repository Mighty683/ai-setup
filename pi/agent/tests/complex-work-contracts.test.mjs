import assert from "node:assert/strict";
import test from "node:test";

const {
  compileImplementationPlan,
  compileResearchBrief,
  validateImplementationPlan,
} = await import("../lib/complex-work-contracts.ts");

function lane(id, scope, isolation = "worktree") {
  return {
    id,
    objective: `MODEL: openai-codex/gpt-5.6-luna; RATIONALE: bounded; ${id}`,
    scope,
    claimedFilesOrContracts: [],
    dependencies: [],
    isolation,
    acceptanceCriteria: [],
    focusedChecks: [],
    stopConditions: [],
  };
}

function plan(waves) {
  return {
    objective: "Implement safely",
    nonGoals: [],
    constraints: [],
    acceptanceCriteria: [],
    userDecisions: [],
    reviewResponse: [],
    waves,
  };
}

function markdown(value) {
  return `# Auditable prose\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

test("research compiler accepts ordinary Markdown with a final JSON record", () => {
  const brief = {
    summary: "Evidence synthesized",
    evidence: ["src/controller.ts:42"],
    constraints: [],
    unresolvedDecisions: [],
    resolvedDecisions: [],
  };
  assert.deepEqual(compileResearchBrief(markdown(brief)), {
    ok: true,
    value: brief,
  });
});

test("plan compiler rejects missing deterministic interchange", () => {
  const result = compileImplementationPlan("# Prose only");
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /No fenced JSON/);
});

test("plan validation rejects dependency cycles", () => {
  const result = validateImplementationPlan(
    plan([
      {
        id: "a",
        dependsOn: ["b"],
        parallel: false,
        lanes: [lane("a-lane", ["src/a.ts"], "shared")],
      },
      {
        id: "b",
        dependsOn: ["a"],
        parallel: false,
        lanes: [lane("b-lane", ["src/b.ts"], "shared")],
      },
    ]),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cycle/);
});

test("parallel lanes must be isolated and claim disjoint resources", () => {
  const result = validateImplementationPlan(
    plan([
      {
        id: "parallel",
        dependsOn: [],
        parallel: true,
        lanes: [
          lane("left", ["src/shared.ts"], "shared"),
          lane("right", ["src/shared.ts"]),
        ],
      },
    ]),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /must use worktree isolation/);
  assert.match(result.errors.join("\n"), /both claim src\/shared.ts/);
});
