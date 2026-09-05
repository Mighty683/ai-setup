const previousWorkflowState = await state.get("complexWork");
const revisionContext = previousWorkflowState?.pendingReview
  ? [
      "This is a replanning cycle after review could not approve the current wave.",
      "Preserve completed waves and explicitly address every blocking review finding.",
      "Previous plan and review evidence:",
      JSON.stringify({
        plan: previousWorkflowState.plan,
        completedWaveIds: previousWorkflowState.completedWaveIds || [],
        pendingReview: previousWorkflowState.pendingReview
      })
    ].join("\n")
  : "This is the initial plan for the mission.";

const planResult = await runs.run("high-level-plan", {
  agent: "plan-unit",
  context: "fork",
  task: [
    "Create the dependency-aware plan for the current complex-work request in the inherited conversation.",
    "Do not implement. Inspect repository state first and protect unrelated work.",
    "Use your bounded nested scout recon when it is useful. Your final action must call the injected structured_output tool exactly once with the complete schema payload. Do not finish with STATUS prose or an ordinary text response.",
    "Each execution wave must be either one serial lane or independent lanes. Concurrent writer lanes must use isolation: worktree.",
    "Every lane must be a bounded implementation objective that a lane-coordinator can own with one nested scout and one nested work-unit.",
    "Every lane must leave the application runnable at its boundary, with focused automated evidence that the runnable state was preserved or restored.",
    "Every lane has one durable docs/tasks record containing its description, research summary, and lifecycle status (todo, started, or finished). The executor assigns the canonical docs/tasks/<wave>-<lane>.md path: do not invent or embed a task-record filename in objectives, scope, acceptance criteria, or prose.",
    "Plan the full dependency graph once. If the user requests fresh per-wave planning, make that an explicit planning-only blocker rather than claiming the fixed execution workflow will create planners automatically.",
    "Each wave ends in an explicit user verification gate after review and before it is closed; plan wave boundaries so a partially complete feature can still run.",
    "Record user-owned and cross-lane decisions as blockers; do not resolve them. Do not propose smoke, manual, or end-to-end smoke tests.",
    "Always return reviewResponse. Use an empty array for an initial plan. During replanning, include one entry for every blocking review finding and name the replacement wave IDs that address it.",
    revisionContext
  ].join("\n"),
  outputSchema: {
    type: "object",
    properties: {
      objective: { type: "string" },
      nonGoals: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      userDecisions: { type: "array", items: { type: "string" } },
      reviewResponse: {
        type: "array",
        items: {
          type: "object",
          properties: {
            finding: { type: "string" },
            addressedByWaveIds: { type: "array", minItems: 1, items: { type: "string" } },
            rationale: { type: "string" }
          },
          required: ["finding", "addressedByWaveIds", "rationale"],
          additionalProperties: false
        }
      },
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
    required: ["objective", "nonGoals", "constraints", "acceptanceCriteria", "userDecisions", "reviewResponse", "waves"],
    additionalProperties: false
  }
});

if (!planResult.ok || !planResult.structuredOutput) {
  throw new Error("The planning lane did not return a valid structured plan.");
}

const plan = planResult.structuredOutput;
const priorReviewFindings = previousWorkflowState?.pendingReview?.reviewFindings || [];
const blockingFindingSummaries = priorReviewFindings.flatMap((review) => (
  (review.structuredOutput?.findings || [])
    .filter((finding) => (
      review.structuredOutput?.verdict === "block" ||
      finding.severity === "P0" ||
      finding.severity === "P1" ||
      finding.solutionKnown === false
    ))
    .map((finding) => finding.summary)
));
if (blockingFindingSummaries.length > 0) {
  const plannedWaveIds = new Set(plan.waves.map((wave) => wave.id));
  const responses = plan.reviewResponse || [];
  const missingResponses = blockingFindingSummaries.filter((summary) => {
    const response = responses.find((candidate) => candidate.finding === summary);
    return !response || !response.addressedByWaveIds.every((id) => plannedWaveIds.has(id));
  });
  if (missingResponses.length > 0) {
    throw new Error(
      "Replanning did not address blocking review findings: " + missingResponses.join("; "),
    );
  }
}
const reviewHistory = previousWorkflowState?.pendingReview
  ? [...(previousWorkflowState.reviewHistory || []), previousWorkflowState.pendingReview]
  : previousWorkflowState?.reviewHistory || [];
await state.set("complexWork", {
  plan,
  planRevision: (previousWorkflowState?.planRevision || 0) + 1,
  completedWaveIds: previousWorkflowState?.completedWaveIds || [],
  activeExecution: null,
  failedExecution: null,
  pendingIntegration: null,
  pendingReview: null,
  pendingUserVerification: null,
  reviewHistory
});

return plan;