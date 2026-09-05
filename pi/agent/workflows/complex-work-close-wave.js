const workflowState = await state.get("complexWork");
if (!workflowState || !workflowState.pendingReview || !workflowState.pendingReview.reviewFindings) {
  throw new Error("A reviewed complex-work wave is required before it can be closed.");
}

if (workflowState.pendingReview.reviewVerdict !== "passed") {
  throw new Error("Review must pass without blocking findings before the wave can be closed.");
}

const closedBatch = workflowState.pendingReview.wave;
const closedWaveIds = closedBatch.sourceWaveIds || [closedBatch.id];
const verification = workflowState.pendingUserVerification;
const verifiedWaveIds = verification?.waveIds || (verification?.waveId ? [verification.waveId] : []);
const batchMatches = (
  verification?.batchId === closedBatch.id ||
  verification?.waveId === closedBatch.id
);
const verificationMatches = (
  batchMatches &&
  closedWaveIds.length === verifiedWaveIds.length &&
  closedWaveIds.every((waveId) => verifiedWaveIds.includes(waveId))
);
if (!verificationMatches) {
  throw new Error("Explicit user verification is required before the execution batch can be closed.");
}
await state.set("complexWork", {
  ...workflowState,
  completedWaveIds: [...new Set([...(workflowState.completedWaveIds || []), ...closedWaveIds])],
  pendingReview: null,
  pendingUserVerification: null
});

return {
  status: "wave-closed",
  completedWaveIds: closedWaveIds,
  message: "The reviewed and user-verified execution batch is closed."
};