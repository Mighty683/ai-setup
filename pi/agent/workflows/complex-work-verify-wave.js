const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingReview || !workflowState.pendingReview.reviewFindings) {
  throw new Error("A reviewed complex-work wave is required before user verification.");
}
if (workflowState.pendingReview.reviewVerdict !== "passed") {
  throw new Error("Review must pass without blocking findings before user verification.");
}

const verifiedWave = workflowState.pendingReview.wave;
await state.set("complexWork", {
  ...workflowState,
  pendingUserVerification: {
    waveId: verifiedWave.id,
    verifiedAt: new Date().toISOString(),
    note: "The parent launched this verification transition after explicit user verification."
  }
});

return {
  status: "user-verification-recorded",
  wave: verifiedWave,
  message: "User verification is recorded. The wave may now be closed."
};
