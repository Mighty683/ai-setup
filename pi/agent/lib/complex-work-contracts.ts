// Versioned interchange for research, executable task graphs, and review evidence.
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const text = () => Type.String({ minLength: 1, pattern: "\\S" });
const id = () => Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" });
const strings = () => Type.Array(text());
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });

export const researchBriefSchema = object({
  summary: text(), evidence: Type.Array(text(), { minItems: 1 }), constraints: strings(),
  unresolvedDecisions: strings(), resolvedDecisions: Type.Optional(strings()),
});
export const resourceSchema = object({
  kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("contract")]),
  name: text(), access: Type.Union([Type.Literal("read"), Type.Literal("write")]),
});
/** An argv command approved with the plan; shell interpolation is never performed. */
export const checkSchema = object({
  id: id(), command: text(), args: strings(),
  cwd: Type.Optional(text()), timeoutMs: Type.Integer({ minimum: 1000, maximum: 1_800_000 }),
});
export const taskSchema = object({
  id: id(), objective: text(), dependsOn: Type.Array(id(), { uniqueItems: true }),
  resources: Type.Array(resourceSchema, { minItems: 1 }),
  criteria: Type.Array(id(), { minItems: 1, uniqueItems: true }),
  checks: Type.Array(checkSchema, { minItems: 1 }), model: Type.Optional(text()),
});
export const planSchema = object({
  version: Type.Literal(2), objective: text(), nonGoals: strings(), constraints: strings(),
  acceptanceCriteria: Type.Array(object({ id: id(), description: text() }), { minItems: 1 }),
  tasks: Type.Array(taskSchema, { minItems: 1, maxItems: 48 }),
  finalChecks: Type.Array(checkSchema, { minItems: 1 }),
});
export const writerResultSchema = object({
  status: Type.Union([Type.Literal("ready"), Type.Literal("blocked")]), summary: text(),
  criteria: Type.Array(id(), { uniqueItems: true }),
  blockers: Type.Array(object({ kind: Type.Union([Type.Literal("implementation"), Type.Literal("decision")]), message: text() })),
});
export const reviewResultSchema = object({
  verdict: Type.Union([Type.Literal("pass"), Type.Literal("fix"), Type.Literal("decision")]),
  coveredCriteria: Type.Array(id(), { minItems: 1, uniqueItems: true }),
  findings: Type.Array(object({ id: id(), taskId: Type.Optional(id()), severity: Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2")]), evidence: text(), correction: text() })),
});
export type ResearchBrief = Static<typeof researchBriefSchema>;
export type ImplementationPlan = Static<typeof planSchema>;
export type Task = Static<typeof taskSchema>;
export type Resource = Static<typeof resourceSchema>;
export type Check = Static<typeof checkSchema>;
export type WriterResult = Static<typeof writerResultSchema>;
export type ReviewResult = Static<typeof reviewResultSchema>;
export type CompilationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Accept canonical repository-relative paths; directory claims have an explicit kind. */
export function safePath(value: string, allowRoot = false): boolean {
  if (allowRoot && value === ".") return true;
  return Boolean(value && !value.startsWith("/") && !/[\\:*?\[\]\x00-\x1f]/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== "..")
    && !value.split("/").some(part => [".git", ".pi"].includes(part.toLowerCase())));
}
export function resourcesConflict(left: Resource, right: Resource): boolean {
  if (left.access === "read" && right.access === "read") return false;
  if (left.kind === "contract" || right.kind === "contract") return left.kind === right.kind && left.name === right.name;
  const a = left.name.toLowerCase();
  const b = right.name.toLowerCase();
  return a === b || (left.kind === "directory" && b.startsWith(a + "/"))
    || (right.kind === "directory" && a.startsWith(b + "/"));
}
export function pathAllowed(file: string, resources: readonly Resource[]): boolean {
  return safePath(file) && resources.some(resource => resource.access === "write"
    && resource.kind !== "contract" && (file === resource.name
      || (resource.kind === "directory" && file.startsWith(resource.name + "/"))));
}
function duplicateIds(items: { id: string }[], label: string): string[] {
  return items.filter((item, index) => items.findIndex(other => other.id === item.id) !== index)
    .map(item => `Duplicate ${label} id: ${item.id}`);
}
export function planSemanticErrors(plan: ImplementationPlan): string[] {
  const errors = [...duplicateIds(plan.tasks, "task"), ...duplicateIds(plan.acceptanceCriteria, "criterion")];
  const tasks = new Map(plan.tasks.map(task => [task.id, task]));
  const criteria = new Set(plan.acceptanceCriteria.map(criterion => criterion.id));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (task: Task) => {
    if (visiting.has(task.id)) { errors.push(`Dependency cycle at ${task.id}`); return; }
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependsOn) {
      const parent = tasks.get(dependency);
      if (!parent) errors.push(`${task.id}: unknown dependency ${dependency}`);
      else visit(parent);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  };
  for (const task of plan.tasks) {
    visit(task);
    if (!task.resources.some(resource => resource.access === "write" && resource.kind !== "contract")) errors.push(`${task.id}: no writable paths`);
    for (const resource of task.resources) {
      if (resource.kind !== "contract" && !safePath(resource.name)) errors.push(`${task.id}: unsafe resource ${resource.name}`);
    }
    for (const criterion of task.criteria) if (!criteria.has(criterion)) errors.push(`${task.id}: unknown criterion ${criterion}`);
    errors.push(...duplicateIds(task.checks, `${task.id} check`));
  }
  for (const criterion of criteria) if (!plan.tasks.some(task => task.criteria.includes(criterion))) errors.push(`Unassigned criterion ${criterion}`);
  errors.push(...duplicateIds(plan.finalChecks, "final check"));
  for (const check of [...plan.tasks.flatMap(task => task.checks), ...plan.finalChecks]) {
    if (check.cwd && !safePath(check.cwd, true)) errors.push(`${check.id}: unsafe check cwd`);
  }
  return [...new Set(errors)];
}
export function validateImplementationPlan(value: unknown): CompilationResult<ImplementationPlan> {
  if (!Value.Check(planSchema, value)) return { ok: false, errors: [...Value.Errors(planSchema, value)].map(error => `${error.instancePath}: ${error.message}`) };
  const errors = planSemanticErrors(value);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
/** Never accept an earlier JSON block when the final authoritative record is invalid. */
export function compileRecord<T>(markdown: string, schema: TSchema): CompilationResult<T> {
  const blocks = [...markdown.matchAll(/```json\s*\n([\s\S]*?)```/gi)];
  const candidate = blocks.at(-1)?.[1] ?? markdown.trim();
  try {
    const value: unknown = JSON.parse(candidate);
    if (!Value.Check(schema, value)) return { ok: false, errors: [...Value.Errors(schema, value)].slice(0, 16).map(error => `${error.instancePath}: ${error.message}`) };
    return { ok: true, value: value as T };
  } catch { return { ok: false, errors: ["End the response with one valid fenced JSON record."] }; }
}
export const compileResearchBrief = (markdown: string) => compileRecord<ResearchBrief>(markdown, researchBriefSchema);
export function compileImplementationPlan(markdown: string): CompilationResult<ImplementationPlan> {
  const compiled = compileRecord<ImplementationPlan>(markdown, planSchema);
  return compiled.ok ? validateImplementationPlan(compiled.value) : compiled;
}
