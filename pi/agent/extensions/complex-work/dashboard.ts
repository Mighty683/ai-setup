/** Human-facing orders derived only from controller state, never from agent report prose. */
import { STAGES, type Action, type Stage, type TaskRecord } from "./state.ts";
import type { MissionChoice } from "./workspace.ts";
import type { MergeApproval } from "./worktrees.ts";

const NEXT_LABELS: Record<string, string> = {
  "gather-info": "Approve brief → Research", research: "Approve direction → Plan", plan: "Approve plan → Implement",
  implementation: "Accept feature → Review", review: "Accept review → Tests", tests: "Accept validation → Merge decision",
};

function order(task: TaskRecord, action: Action, label: string, target?: Stage, confirmation?: string): MissionChoice {
  return { value: ["act", task.state.taskId, task.state.revision, action, target ?? ""].join("/"), label, confirmation };
}

const STATUS_LABELS: Record<TaskRecord["state"]["executionStatus"], string> = {
  ready: "Ready to start", running: "Working", "awaiting-user": "Ready for your decision",
  paused: "Paused", failed: "Needs attention", ended: "Finished", cancelled: "Cancelled",
};

export function missionSummary(task: TaskRecord): string {
  const { state } = task;
  const latest = state.stageRuns.filter(run => run.stage === state.currentState).at(-1);
  const outcomes = { "ended-early": "Ended before full validation", validated: "Validation accepted", cancelled: "Cancelled", merged: "Merged into the original branch" };
  return [`Current stage: ${state.currentState} · ${STATUS_LABELS[state.executionStatus]}`,
    latest?.error ? `Needs attention: ${latest.error}` : "", state.worktree?.mergeAttempt?.error ? `Merge needs attention: ${state.worktree.mergeAttempt.error}` : "", state.outcome ? outcomes[state.outcome] : ""].filter(Boolean).join("\n");
}

export function missionChoices(task: TaskRecord, merge?: MergeApproval): MissionChoice[] {
  const { state } = task;
  const choices: MissionChoice[] = [];
  if (state.executionStatus === "awaiting-user" && state.currentState !== "merge") choices.push(order(task, "next", NEXT_LABELS[state.currentState] ?? "Next",
    undefined, state.currentState === "tests" ? "Accept this committed candidate's test evidence and proceed to a separate merge decision? No merge or task closure happens now." : "Approve this attempt and dispatch the next stage?"));
  if (state.currentState === "merge" && state.executionStatus === "awaiting-user" && merge) choices.push({
    value: ["act", state.taskId, state.revision, "merge", merge.sourceHead, merge.candidateHead].join("/"),
    label: "Merge and close task",
    confirmation: `Merge the committed candidate into ${state.worktree!.baseBranch} and close this task? Keep the worktree and branch; never push. Conflicts leave the task open for explicit resolution.`,
  });
  const prior = STAGES.filter(stage => stage !== "end" && STAGES.indexOf(stage) < STAGES.indexOf(state.currentState)
    && state.history.some(entry => entry.to === stage));
  for (const stage of prior) choices.push(order(task, state.currentState === "end" ? "reopen" : "back",
    `${state.currentState === "end" ? "Reopen" : "Return to"} ${stage}`, stage, "Return here, preserve code/reports, and invalidate downstream approvals? An active run must settle first."));
  if (!["merge", "end"].includes(state.currentState) && ["awaiting-user", "ready", "failed"].includes(state.executionStatus)) choices.push(order(task, "retry", "Retry stage", undefined,
    "Retry this stage with your feedback? Earlier reports and code remain intact."));
  return [...choices, { value: "options", label: "Mission options" }];
}

export function missionOptions(task: TaskRecord): MissionChoice[] {
  const { state } = task;
  const choices: MissionChoice[] = [];
  if (state.currentState !== "end") {
    choices.push(order(task, state.executionStatus === "paused" ? "resume" : "pause", state.executionStatus === "paused" ? "Resume" : "Pause"));
    choices.push(order(task, "cancel", "Cancel mission — preserve work", undefined, "Cancel this mission? All code and reports remain; nothing is merged."));
    if (["implementation", "review", "tests", "merge"].includes(state.currentState)) choices.push(order(task, "end", "End without merging", undefined,
      "End this task without merging or claiming validated completion? Preserve the worktree, branch, code, and reports."));
  }
  choices.push({ value: `remove/${state.taskId}/${state.revision}`, label: "Remove mission",
    confirmation: "Remove this mission from the saved list? Active agents must stop and settle first. Keep reports, code, worktree, and Git branch; nothing is deleted or merged." });
  return [...choices, { value: "new", label: "Start another mission" }, { value: "tasks", label: "Open stored mission" },
    { value: "refresh", label: "Refresh status" }, { value: "home", label: "Back to mission" }, { value: "close", label: "Return to Pi" }];
}
