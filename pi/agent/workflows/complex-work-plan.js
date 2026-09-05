const workflowState = await state.get("complexWork");
if (!workflowState?.researchBrief) {
  throw new Error("Planning requires an authoritative research brief.");
}

const planResult = await runs.run("high-level-plan", {
  agent: "plan-unit",
  context: "fresh",
  task: [
    "Create an implementation-only dependency plan from the authoritative research brief below.",
    "Return ordinary Markdown. Do not call structured_output and do not implement.",
    "Do not repeat broad reconnaissance; perform only narrow checks for a concrete missing fact.",
    "Authoritative research brief:",
    JSON.stringify(workflowState.researchBrief),
    workflowState.plan ? "Previous plan:\n" + JSON.stringify(workflowState.plan) : "",
    workflowState.failedIntegration ? "Integration correction evidence:\n" + JSON.stringify(workflowState.failedIntegration) : "",
    workflowState.pendingReview ? "Review correction evidence:\n" + JSON.stringify(workflowState.pendingReview) : ""
  ].filter(Boolean).join("\n\n")
});

if (!planResult.ok || !planResult.output?.trim()) {
  throw new Error("The planning lane did not return a readable Markdown plan.");
}

return {
  status: "plan-draft",
  planMarkdown: planResult.output.trim(),
  runId: planResult.runId
};
