// Scope approval, model-authored work graphs, and revision-bound evidence contracts.
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const text = () => Type.String({ minLength: 1, pattern: "\\S" });
const id = () => Type.String({ pattern: "^(?!(?:constructor|prototype)$)[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" });
const strings = () => Type.Array(text());
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });

export const researchBriefSchema = object({
  summary: text(), evidence: Type.Array(text(), { minItems: 1 }), constraints: strings(),
  unresolvedDecisions: strings(), resolvedDecisions: Type.Optional(strings()),
});
/** The coordinating model supplies identities and instructions; capabilities come from the execution contract. */
export const assignmentSchema = object({ id: id(), name: text(), instructions: text(), model: Type.Optional(text()) });
export type Assignment = Static<typeof assignmentSchema>;
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
  id: id(), objective: text(),
  resources: Type.Array(resourceSchema, { minItems: 1 }),
  criteria: Type.Array(id(), { minItems: 1, uniqueItems: true }),
  checks: Type.Array(checkSchema, { minItems: 1 }),
});
export const planSchema = object({
  version: Type.Literal(3), objective: text(), nonGoals: strings(), constraints: strings(),
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
  const criteria = new Set(plan.acceptanceCriteria.map(criterion => criterion.id));
  for (const task of plan.tasks) {
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

/** Operations describe capabilities and evidence, never a prescribed research/implementation sequence. */
const workBase = { id: id(), dependsOn: Type.Array(id(), { uniqueItems: true }), allowFailed: Type.Optional(Type.Array(id(), { uniqueItems: true })) };
export const workSchema = Type.Union([
  object({ ...workBase, kind: Type.Literal("agent"), access: Type.Union([Type.Literal("read"), Type.Literal("write")]),
    assignment: assignmentSchema, taskId: Type.Optional(id()), input: Type.Optional(id()) }),
  object({ ...workBase, kind: Type.Literal("review"), assignment: assignmentSchema,
    taskId: Type.Optional(id()), input: id() }),
  object({ ...workBase, kind: Type.Literal("check"), taskId: Type.Optional(id()), input: Type.Optional(id()) }),
  object({ ...workBase, kind: Type.Literal("integrate"), taskId: id(), input: id(),
    checks: Type.Array(id(), { minItems: 1, uniqueItems: true }), reviews: Type.Array(id(), { minItems: 1, uniqueItems: true }) }),
]);
export const workBatchSchema = Type.Array(workSchema, { minItems: 1, maxItems: 128 });
export type WorkDefinition = Static<typeof workSchema>;
/** Drop ledger metadata when validating a stored operation's executable definition. */
export function workDefinition(job: Record<string, unknown>): WorkDefinition {
  const keys = ["id", "dependsOn", "allowFailed", "kind", "access", "assignment", "taskId", "input", "checks", "reviews"];
  return Object.fromEntries(keys.filter(key => job[key] !== undefined).map(key => [key, job[key]])) as WorkDefinition;
}
export const deliverySchema = object({
  checks: Type.Array(id(), { minItems: 1, uniqueItems: true }),
  reviews: Type.Array(id(), { minItems: 1, uniqueItems: true }),
});
export type DeliveryEvidence = Static<typeof deliverySchema>;

/** Validate the entire append before admitting any work; existing work is immutable. */
export function validateWorkBatch(value: unknown, existing: WorkDefinition[]): CompilationResult<WorkDefinition[]> {
  const parsed = compileRecord<WorkDefinition[]>(JSON.stringify(value), workBatchSchema);
  if (!parsed.ok) return parsed;
  const all = [...existing, ...parsed.value];
  const errors = duplicateIds(all, "work");
  const items = new Map(all.map(item => [item.id, item]));
  const seen = new Set<string>(); const visiting = new Set<string>();
  const visit = (item: WorkDefinition) => {
    if (visiting.has(item.id)) { errors.push(`Dependency cycle at ${item.id}`); return; }
    if (seen.has(item.id)) return;
    visiting.add(item.id);
    for (const id of item.dependsOn) {
      const parent = items.get(id);
      if (!parent) errors.push(`${item.id}: unknown dependency ${id}`);
      else visit(parent);
    }
    visiting.delete(item.id); seen.add(item.id);
  };
  for (const item of all) {
    visit(item);
    for (const ref of item.allowFailed ?? []) if (!item.dependsOn.includes(ref)) errors.push(`${item.id}: allowed failed input ${ref} must be a dependency`);
    const references = [item.input, ...(item.kind === "integrate" ? [...item.checks, ...item.reviews] : [])].filter(Boolean) as string[];
    for (const ref of references) if (!item.dependsOn.includes(ref)) errors.push(`${item.id}: evidence/input ${ref} must be a direct dependency`);
    if (item.kind === "agent" && item.access === "write" && !item.taskId) errors.push(`${item.id}: writable work requires an approved taskId`);
    if (item.kind === "check" && item.taskId && !item.input) errors.push(`${item.id}: task checks require a candidate input`);
  }
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : parsed;
}
