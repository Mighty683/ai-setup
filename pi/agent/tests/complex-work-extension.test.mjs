import assert from "node:assert/strict";
import test from "node:test";

import complexWorkExtension from "../extensions/complex-work.ts";

function extensionHarness() {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const entries = [];
  const userMessages = [];
  let activeTools = ["subagent"];

  const pi = {
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data: structuredClone(data) });
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names) {
      activeTools = [...names];
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    sendUserMessage(content) {
      userMessages.push(content);
    },
    setSessionName() {},
  };

  complexWorkExtension(pi);
  return { handlers, commands, tools, entries, userMessages };
}

function commandContext() {
  return {
    sessionManager: {
      getSessionFile() {
        return "/tmp/complex-work-session.jsonl";
      },
    },
    ui: { notify() {} },
  };
}

test("steering commands route through the gated control tool", async () => {
  const harness = extensionHarness();
  await harness.commands
    .get("complex-work")
    .handler("review loop", commandContext());

  await harness.commands
    .get("complex-work-abandon")
    .handler("", commandContext());

  assert.match(
    harness.userMessages.at(-1),
    /complex_work_control with action "abandon"/,
  );
});

test("planning retry requires an explicitly recorded workflow failure", async () => {
  const harness = extensionHarness();
  await harness.commands
    .get("complex-work")
    .handler("review loop", commandContext());
  const control = harness.tools.get("complex_work_control");

  await control.execute("plan", { action: "plan" });
  harness.handlers.get("tool_call")({
    toolName: "subagent",
    input: {
      workflowScriptPath:
        "/home/might/.pi/agent/workflows/complex-work-plan.js",
    },
  });

  await assert.rejects(
    control.execute("retry", { action: "retry-plan" }),
    /only valid after plan-failed/,
  );

  await control.execute("failed", {
    action: "plan-failed",
    resultStatus: "planning-failed",
  });
  const retry = await control.execute("retry", { action: "retry-plan" });

  assert.match(retry.content[0].text, /Authorized workflow: plan/);
  assert.equal(retry.details.state.phase, "planning");
  assert.equal(retry.details.state.expectedAction, "plan");
});

test("replanning launch cannot switch mission IDs", async () => {
  const harness = extensionHarness();
  await harness.commands
    .get("complex-work")
    .handler("review loop", commandContext());
  const control = harness.tools.get("complex_work_control");

  await control.execute("plan", { action: "plan" });
  harness.handlers.get("tool_call")({
    toolName: "subagent",
    input: {
      workflowScriptPath:
        "/home/might/.pi/agent/workflows/complex-work-plan.js",
    },
  });
  await control.execute("planned", {
    action: "plan-complete",
    missionId: "mission-one",
  });
  await control.execute("go", { action: "go" });

  const blocked = harness.handlers.get("tool_call")({
    toolName: "subagent",
    input: {
      workflowScriptPath:
        "/home/might/.pi/agent/workflows/complex-work-execute-wave.js",
      missionId: "mission-two",
    },
  });

  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /mission-one/);
});
