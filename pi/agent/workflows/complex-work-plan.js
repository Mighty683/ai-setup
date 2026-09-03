const planResult = await runs.run("high-level-plan", {
  agent: "plan-unit",
  context: "fork",
  task: [
    "Create the dependency-aware plan for the current complex-work request in the inherited conversation.",
    "Do not implement. Inspect repository state first and protect unrelated work.",
    "Use your bounded nested scout recon when it is useful. Return only the structured plan required by the output schema.",
    "Each execution wave must be either one serial lane or independent lanes. Concurrent writer lanes must use isolation: worktree.",
    "Every lane must be a bounded implementation objective that a lane-coordinator can own with one nested scout and one nested work-unit.",
    "Every lane must leave the application runnable at its boundary, with focused automated evidence that the runnable state was preserved or restored.",
    "Every lane has a durable docs/tasks record containing its description, research summary, and lifecycle status (todo, started, or finished).",
    "Each wave ends in an explicit user verification gate after review and before it is closed; plan wave boundaries so a partially complete feature can still run.",
    "Record user-owned and cross-lane decisions as blockers; do not resolve them. Do not propose smoke, manual, or end-to-end smoke tests."
  ].join("\n"),
  outputSchema: {
    type: "object",
    properties: {
      objective: { type: "string" },
      nonGoals: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      userDecisions: { type: "array", items: { type: "string" } },
      waves: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            dependsOn: { type: "array", items: { type: "string" } },
            parallel: { type: "boolean" },
            lanes: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  objective: { type: "string" },
                  scope: { type: "array", items: { type: "string" } },
                  claimedFilesOrContracts: { type: "array", items: { type: "string" } },
                  dependencies: { type: "array", items: { type: "string" } },
                  isolation: { type: "string", enum: ["shared", "worktree"] },
                  acceptanceCriteria: { type: "array", items: { type: "string" } },
                  focusedChecks: { type: "array", items: { type: "string" } },
                  stopConditions: { type: "array", items: { type: "string" } }
                },
                required: ["id", "objective", "scope", "claimedFilesOrContracts", "dependencies", "isolation", "acceptanceCriteria", "focusedChecks", "stopConditions"],
                additionalProperties: false
              }
            }
          },
          required: ["id", "dependsOn", "parallel", "lanes"],
          additionalProperties: false
        }
      }
    },
    required: ["objective", "nonGoals", "constraints", "acceptanceCriteria", "userDecisions", "waves"],
    additionalProperties: false
  }
});

if (!planResult.ok || !planResult.structuredOutput) {
  throw new Error("The planning lane did not return a valid structured plan.");
}

const plan = planResult.structuredOutput;
await state.set("complexWork", {
  plan,
  completedWaveIds: [],
  pendingIntegration: null,
  pendingReview: null
});

return plan;