# Portable AI workflow

Reusable task planning, review, and research practices for any AI agent harness.
The workflow follows each project's instructions, document layout, product
constraints, and available evidence. It does not install or activate itself.

- `skills/`: task-specific instructions. Each `SKILL.md` has a name and
  description in YAML frontmatter and a Markdown procedure. A harness with skill
  discovery can register these directories; otherwise, supply the relevant file
  as context when requesting that work.
- `agents/`: role instructions in plain Markdown. Supply a role's file as context
  to an agent or adapt it to the harness's agent configuration. Delegate only when
  the user and the harness permit it; otherwise follow the procedure directly.

Use only the phases and roles the task needs. Project-specific instructions take
precedence; these files do not replace a project's existing workflow. Configure
search paths, role registration, and permissions through the chosen harness.
