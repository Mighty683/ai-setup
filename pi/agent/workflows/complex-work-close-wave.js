const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingReview || !workflowState.pendingReview.reviewFindings) {
  throw new Error("A reviewed complex-work wave is required before it can be closed.");
}

if (workflowState.pendingReview.reviewFindings.some((finding) => !finding.ok)) {
  throw new Error("All review lanes must complete successfully before the wave can be closed.");
}

const closedWave = workflowState.pendingReview.wave.id;
await state.set("complexWork", {
  ...workflowState,
  completedWaveIds: [...workflowState.completedWaveIds, closedWave],
  pendingReview: null
});

return {
  status: "wave-closed",
  completedWaveId: closedWave,
  message: "Use this only after the parent has dispositioned review findings and completed any accepted fix work."
};