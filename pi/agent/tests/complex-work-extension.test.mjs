import assert from "node:assert/strict";
import test from "node:test";

process.env.PI_SOUND_DISABLED = "1";
const { default: complexWorkExtension } = await import(
  "../extensions/complex-work.ts"
);

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

test("replays valid chronological snapshots and coalesces phase durations", async () => {
  const {
    replayComplexWorkStates,
    buildPhaseHistory,
    formatComplexWorkStatus,
  } = await import("../extensions/complex-work.ts");
  const entries = [
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "ship popup",
        phase: "planning",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    },
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "ship popup",
        phase: "planning",
        updatedAt: "2025-01-01T00:00:30.000Z",
      },
    },
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "ship popup",
        phase: "bad",
        updatedAt: "2025-01-01T00:01:00.000Z",
      },
    },
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "ship popup",
        phase: "awaiting-go",
        updatedAt: "2025-01-01T00:02:00.000Z",
      },
    },
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "",
        phase: "executing",
        updatedAt: "2025-01-01T00:03:00.000Z",
      },
    },
  ];
  const states = replayComplexWorkStates(entries);
  const history = buildPhaseHistory(states);
  assert.equal(states.length, 3);
  assert.deepEqual(
    history.map(({ phase }) => phase),
    ["planning", "awaiting-go"],
  );
  assert.match(formatComplexWorkStatus(states.at(-1), history), /planning: 2m/);
  assert.match(
    formatComplexWorkStatus(states.at(-1), history),
    /current since 2025-01-01T00:02:00.000Z/,
  );
});

test("status opens and closes a TUI overlay but uses deterministic non-TUI text", async () => {
  const harness = extensionHarness();
  const branch = [
    {
      type: "custom",
      customType: "complex-work-state",
      data: {
        request: "status popup",
        phase: "executing",
        rootSessionFile: "/tmp/complex-work-session.jsonl",
        expectedAction: "execute",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    },
  ];
  let component;
  let overlayOptions;
  const notifications = [];
  const context = {
    ...commandContext(),
    mode: "tui",
    sessionManager: {
      getSessionFile: () => "/tmp/complex-work-session.jsonl",
      getBranch: () => branch,
    },
    ui: {
      notify: (...args) => notifications.push(args),
      custom(factory, options) {
        overlayOptions = options;
        component = factory({ requestRender() {} }, {}, {}, () => {
          component = undefined;
        });
        return Promise.resolve();
      },
    },
  };
  harness.handlers.get("session_start")({}, context);
  await harness.commands.get("complex-work-status").handler("", context);
  assert.equal(overlayOptions.overlay, true);
  assert.match(component.render(28).join("\n"), /Complex Work Status/);
  for (let index = 0; index < 20; index++) component.handleInput("\x1b[B");
  assert.match(component.render(28).join("\n"), /Complex work: status popup/);
  component.handleInput("\r");
  assert.equal(component, undefined);
  await harness.commands
    .get("complex-work-status")
    .handler("", { ...context, mode: "print" });
  assert.match(notifications.at(-1)[0], /Current phase: executing/);
  assert.equal(harness.userMessages.length, 0);
});

test("status remains unavailable outside the active root session", async () => {
  const harness = extensionHarness();
  const notifications = [];
  const context = {
    ...commandContext(),
    mode: "print",
    sessionManager: {
      getSessionFile: () => "/tmp/child.jsonl",
      getBranch: () => [
        {
          type: "custom",
          customType: "complex-work-state",
          data: {
            request: "root only",
            phase: "executing",
            rootSessionFile: "/tmp/root.jsonl",
            updatedAt: "2025-01-01T00:00:00.000Z",
          },
        },
      ],
    },
    ui: { notify: (...args) => notifications.push(args) },
  };
  harness.handlers.get("session_start")({}, context);
  await harness.commands.get("complex-work-status").handler("", context);
  assert.match(notifications.at(-1)[0], /No active complex-work session/);
});
