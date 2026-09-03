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

const reviews = await runs.all([
  {
    key: "review-" + pendingReview.wave.id + "-correctness",
    agent: "review-unit",
    context: "fresh",
    task: reviewContext + "\nANGLE: correctness, regressions, and contract compatibility.",
    output: false
  },
  {
    key: "review-" + pendingReview.wave.id + "-validation",
    agent: "review-unit",
    context: "fresh",
    task: reviewContext + "\nANGLE: acceptance criteria and focused production-path validation evidence.",
    output: false
  },
  {
    key: "review-" + pendingReview.wave.id + "-maintainability",
    agent: "review-unit",
    context: "fresh",
    task: reviewContext + "\nANGLE: scope discipline, maintainability, and integration simplicity.",
    output: false
  }
]);

const reviewFindings = reviews.map((result) => ({
  runId: result.runId,
  ok: result.ok,
  output: result.output
}));
await state.set("complexWork", {
  ...workflowState,
  pendingReview: { ...pendingReview, reviewFindings }
});

return { status: "review-disposition-required", wave: pendingReview.wave, reviewFindings };