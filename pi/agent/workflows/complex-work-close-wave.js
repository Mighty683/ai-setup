const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingReview || !workflowState.pendingReview.reviewFindings) {
  throw new Error("A reviewed complex-work wave is required before it can be closed.");
}

if (workflowState.pendingReview.reviewFindings.some((finding) => !finding.ok)) {
  throw new Error("All review lanes must complete successfully before the wave can be closed.");
}

const closedWave = workflowState.pendingReview.wave.id;
if (!workflowState.pendingUserVerification || workflowState.pendingUserVerification.waveId !== closedWave) {
  throw new Error("Explicit user verification is required before the wave can be closed. Run complex-work-verify-wave.js only after the user verifies the runnable wave.");
}
await state.set("complexWork", {
  ...workflowState,
  completedWaveIds: [...workflowState.completedWaveIds, closedWave],
  pendingReview: null,
  pendingUserVerification: null
});

return {
  status: "wave-closed",
  completedWaveId: closedWave,
  message: "Use this only after the parent has dispositioned review findings and completed any accepted fix work."
};