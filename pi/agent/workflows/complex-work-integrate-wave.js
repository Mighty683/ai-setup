const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingIntegration) {
  throw new Error("No executed complex-work wave is awaiting integration.");
}

const pendingIntegration = workflowState.pendingIntegration;
const integrationOutputSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["integrated", "blocked"] },
    summary: { type: "string" },
    appliedArtifacts: { type: "array", items: { type: "string" } },
    changedFiles: { type: "array", items: { type: "string" } },
    taskRecords: { type: "array", items: { type: "string" } },
    checks: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } }
  },
  required: ["status", "summary", "appliedArtifacts", "changedFiles", "taskRecords", "checks", "blockers"],
  additionalProperties: false
};

const integration = await runs.run("integrate-" + pendingIntegration.wave.id, {
  agent: "work-unit",
  task: [
    "Integrate exactly this completed complex-work wave into the active checkout.",
    "You are the sole integration writer. Treat every lane result as a candidate, not authority.",
    "Inspect each handoff/artifact, including durable patch paths recorded after managed-worktree cleanup. Apply only successful scoped changes in dependency order.",
    "If you encounter a semantic conflict, failed acceptance, missing patch, or cross-lane decision, stop and return an integration-failed blocker. Do not pause or detach this workflow through contact_supervisor.",
    "Do not overwrite unrelated work. Do not merge branches, rebase, reset, clean, stage, push, publish, or release.",
    "Run only focused automated checks. Do not run smoke, manual, or end-to-end smoke tests.",
    "Verify that this wave's lane task records under docs/tasks/ have an accurate Description, Research summary, and Status (todo, started, or finished). Do not close a wave that leaves the application unrunnable; report the exact runnable-state evidence or blocker.",
    "Your final action must call the injected structured_output tool exactly once. Return status integrated only after at least one expected change is present in the active checkout, task records exist, focused checks pass, and no blocker remains; otherwise return blocked.",
    "Wave and lane handoffs:",
    JSON.stringify(pendingIntegration)
  ].join("\n"),
  output: "integration/" + pendingIntegration.wave.id + ".md",
  outputSchema: integrationOutputSchema
});

const integrationAccepted = (
  integration.ok &&
  integration.structuredOutput?.status === "integrated" &&
  integration.structuredOutput?.changedFiles?.length > 0 &&
  integration.structuredOutput?.taskRecords?.length > 0 &&
  integration.structuredOutput?.checks?.length > 0 &&
  integration.structuredOutput?.blockers?.length === 0
);
if (!integrationAccepted) {
  await state.set("complexWork", {
    ...workflowState,
    failedIntegration: {
      wave: pendingIntegration.wave,
      runId: integration.runId,
      output: integration.output,
      structuredOutput: integration.structuredOutput
    }
  });
  return {
    status: "integration-failed",
    wave: pendingIntegration.wave,
    integration: integration.output,
    structuredOutput: integration.structuredOutput
  };
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
      structuredOutput: integration.structuredOutput,
      artifactPaths: integration.artifactPaths
    }
  }
});

return {
  status: "review-required",
  wave: pendingIntegration.wave,
  integration: integration.output,
  structuredOutput: integration.structuredOutput
};