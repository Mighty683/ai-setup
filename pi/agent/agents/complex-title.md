---
name: complex-title
description: Return a short title for a complex-work task
tools:
systemPromptMode: append
defaultContext: fresh
extensions:
acceptance: {level: none, reason: User owns SDLC gates}
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
---

# Complex Title
Name the mission from the initial task text only.
Return one plain-text title of 3–6 words. No quotes, Markdown, explanation, or structured output.
Do not use tools, write files, choose paths, or change workflow state.
Stop after the title. The controller owns state.json and all transitions.
