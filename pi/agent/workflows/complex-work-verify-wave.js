const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingReview || !workflowState.pendingReview.reviewFindings) {
  throw new Error("A reviewed complex-work wave is required before user verification.");
}
if (workflowState.pendingReview.reviewVerdict !== "passed") {
  throw new Error("Review must pass without blocking findings before user verification.");
}

const verifiedWave = workflowState.pendingReview.wave;
const verifiedWaveIds = verifiedWave.sourceWaveIds || [verifiedWave.id];
await state.set("complexWork", {
  ...workflowState,
  pendingUserVerification: {
    batchId: verifiedWave.id,
    waveIds: verifiedWaveIds,
    verifiedAt: new Date().toISOString(),
    note: "The parent launched this verification transition after explicit user verification."
  }
});

return {
  status: "user-verification-recorded",
  wave: verifiedWave,
  waveIds: verifiedWaveIds,
  message: "User verification is recorded. The execution batch may now be closed."
};
