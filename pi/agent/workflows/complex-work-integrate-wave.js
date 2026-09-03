const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingIntegration) {
  throw new Error("No executed complex-work wave is awaiting integration.");
}

const pendingIntegration = workflowState.pendingIntegration;
const integration = await runs.run("integrate-" + pendingIntegration.wave.id, {
  agent: "work-unit",
  task: [
    "Integrate exactly this completed complex-work wave into the active checkout.",
    "You are the sole integration writer. Treat every lane result as a candidate, not authority.",
    "Inspect each handoff/artifact, apply only successful scoped changes in dependency order, and stop for semantic conflicts, failed acceptance, or a cross-lane decision through contact_supervisor.",
    "Do not overwrite unrelated work. Do not merge branches, rebase, reset, clean, stage, push, publish, or release.",
    "Run only focused automated checks. Do not run smoke, manual, or end-to-end smoke tests.",
    "Verify that this wave's lane task records under docs/tasks/ have an accurate Description, Research summary, and Status (todo, started, or finished). Do not close a wave that leaves the application unrunnable; report the exact runnable-state evidence or blocker.",
    "Wave and lane handoffs:",
    JSON.stringify(pendingIntegration)
  ].join("\n"),
  output: "integration/" + pendingIntegration.wave.id + ".md",
  outputMode: "file-only"
});

if (!integration.ok) {
  return { status: "integration-failed", wave: pendingIntegration.wave, integration: integration.output };
}

await state.set("complexWork", {
  ...workflowState,
  pendingIntegration: null,
  pendingReview: {
    wave: pendingIntegration.wave,
    integration: {
      runId: integration.runId,
      ok: integration.ok,
      output: integration.output,
      artifactPaths: integration.artifactPaths
    }
  }
});

return { status: "review-required", wave: pendingIntegration.wave, integration: integration.output };