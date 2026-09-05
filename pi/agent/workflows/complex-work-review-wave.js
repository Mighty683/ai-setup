const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingReview) {
  throw new Error("No integrated complex-work wave is awaiting review.");
}

const pendingReview = workflowState.pendingReview;
const reviewContext = [
  "Review the active-checkout diff created by the integrated complex-work wave.",
  "Inspect the actual source and diff; the integration handoff is evidence, not authority.",
  "Do not edit, install dependencies, stage, commit, merge, clean, or run smoke, manual, or end-to-end smoke tests.",
  "Confirm the wave leaves the application runnable from the available focused automated evidence, and check that its docs/tasks records contain Description, Research summary, and an accurate lifecycle Status.",
  "Wave:",
  JSON.stringify(pendingReview.wave),
  "Integration handoff:",
  String(pendingReview.integration.output)
].join("\n");

const reviewOutputSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "block"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          summary: { type: "string" },
          evidence: { type: "string" },
          solutionKnown: { type: "boolean" },
          suggestedCorrection: { type: "string" }
        },
        required: ["severity", "summary", "evidence", "solutionKnown", "suggestedCorrection"],
        additionalProperties: false
      }
    },
    validation: { type: "array", items: { type: "string" } },
    residualGaps: { type: "array", items: { type: "string" } }
  },
  required: ["verdict", "findings", "validation", "residualGaps"],
  additionalProperties: false
};

function reviewTask(angle) {
  return [
    reviewContext,
    "ANGLE: " + angle,
    "Your final action must call the injected structured_output tool exactly once.",
    "Use verdict block for any finding that prevents approval. Mark solutionKnown false when user or planner direction is required."
  ].join("\n");
}

const reviews = await runs.all([
  {
    key: "review-" + pendingReview.wave.id + "-correctness",
    agent: "review-unit",
    context: "fresh",
    task: reviewTask("correctness, regressions, and contract compatibility."),
    outputSchema: reviewOutputSchema,
    output: false
  },
  {
    key: "review-" + pendingReview.wave.id + "-validation",
    agent: "review-unit",
    context: "fresh",
    task: reviewTask("acceptance criteria and focused production-path validation evidence."),
    outputSchema: reviewOutputSchema,
    output: false
  },
  {
    key: "review-" + pendingReview.wave.id + "-maintainability",
    agent: "review-unit",
    context: "fresh",
    task: reviewTask("scope discipline, maintainability, and integration simplicity."),
    outputSchema: reviewOutputSchema,
    output: false
  }
]);

const reviewFindings = reviews.map((result) => {
  const structuredOutput = result.structuredOutput;
  const requiresSyntheticFinding = (
    !result.ok ||
    !structuredOutput ||
    (structuredOutput.verdict === "block" && structuredOutput.findings.length === 0)
  );
  const effectiveStructuredOutput = requiresSyntheticFinding
    ? {
        verdict: "block",
        findings: [{
          severity: "P1",
          summary: `Review lane ${result.runId || "unknown"} did not produce an approvable finding report`,
          evidence: result.output || "The review run failed or returned block without a concrete finding.",
          solutionKnown: false,
          suggestedCorrection: "Replan with explicit investigation of this failed review lane."
        }],
        validation: structuredOutput?.validation || [],
        residualGaps: structuredOutput?.residualGaps || ["Review evidence is incomplete."]
      }
    : structuredOutput;
  return {
    runId: result.runId,
    ok: result.ok,
    output: result.output,
    structuredOutput: effectiveStructuredOutput
  };
});
function hasBlockingFinding(result) {
  const findings = result.structuredOutput?.findings || [];
  return findings.some((finding) => (
    finding.severity === "P0" ||
    finding.severity === "P1" ||
    finding.solutionKnown === false
  ));
}

const reviewPassed = reviewFindings.every((finding) => (
  finding.ok &&
  finding.structuredOutput?.verdict === "pass" &&
  !hasBlockingFinding(finding)
));
const reviewVerdict = reviewPassed ? "passed" : "decision-required";
await state.set("complexWork", {
  ...workflowState,
  pendingReview: { ...pendingReview, reviewFindings, reviewVerdict }
});

return {
  status: reviewPassed ? "review-passed" : "review-decision-required",
  wave: pendingReview.wave,
  reviewFindings,
  message: reviewPassed
    ? "Review passed. Obtain explicit user verification."
    : "Review found blocking or unresolved findings. Present them to the user; replan or abandon only after the user's decision."
};