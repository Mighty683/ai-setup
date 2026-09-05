// Complex-work contracts: validated research and dependency-plan interchange.

import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const identifierOptions = {
  minLength: 1,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
};

export const researchBriefSchema = Type.Object(
  {
    summary: Type.String({ minLength: 1 }),
    evidence: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    constraints: Type.Array(Type.String({ minLength: 1 })),
    unresolvedDecisions: Type.Array(Type.String({ minLength: 1 })),
    resolvedDecisions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

export const laneSchema = Type.Object(
  {
    id: Type.String(identifierOptions),
    objective: Type.String({ minLength: 1 }),
    scope: Type.Array(Type.String({ minLength: 1 })),
    claimedFilesOrContracts: Type.Array(Type.String({ minLength: 1 })),
    dependencies: Type.Array(Type.String({ minLength: 1 })),
    isolation: Type.Union([
      Type.Literal("shared"),
      Type.Literal("worktree"),
    ]),
    acceptanceCriteria: Type.Array(Type.String({ minLength: 1 })),
    focusedChecks: Type.Array(Type.String({ minLength: 1 })),
    stopConditions: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const planSchema = Type.Object(
  {
    objective: Type.String({ minLength: 1 }),
    nonGoals: Type.Array(Type.String({ minLength: 1 })),
    constraints: Type.Array(Type.String({ minLength: 1 })),
    acceptanceCriteria: Type.Array(Type.String({ minLength: 1 })),
    userDecisions: Type.Array(Type.String({ minLength: 1 })),
    reviewResponse: Type.Array(
      Type.Object(
        {
          finding: Type.String({ minLength: 1 }),
          addressedByWaveIds: Type.Array(Type.String(identifierOptions), {
            minItems: 1,
          }),
          rationale: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    waves: Type.Array(
      Type.Object(
        {
          id: Type.String(identifierOptions),
          dependsOn: Type.Array(Type.String(identifierOptions)),
          parallel: Type.Boolean(),
          lanes: Type.Array(laneSchema, { minItems: 1, maxItems: 4 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 6 },
    ),
  },
  { additionalProperties: false },
);

export type ResearchBrief = Static<typeof researchBriefSchema>;
export type ImplementationPlan = Static<typeof planSchema>;

export type CompilationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function fencedJsonCandidates(markdown: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*\n([\s\S]*?)```/gi;
  for (const match of markdown.matchAll(fencePattern)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const trimmed = markdown.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }
  return candidates.toReversed();
}

function schemaErrors(schema: TSchema, value: unknown): string[] {
  return [...Value.Errors(schema, value)]
    .slice(0, 12)
    .map((error) => `${error.instancePath || "/"}: ${error.message}`);
}

function compileMarkdownObject<T>(
  markdown: string,
  schema: TSchema,
  semanticErrors: (value: T) => string[],
): CompilationResult<T> {
  const candidates = fencedJsonCandidates(markdown);
  if (candidates.length === 0) {
    return {
      ok: false,
      errors: ["No fenced JSON object was found in the Markdown response."],
    };
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      failures.push(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!Value.Check(schema, parsed)) {
      failures.push(...schemaErrors(schema, parsed));
      continue;
    }
    const contractErrors = semanticErrors(parsed as T);
    if (contractErrors.length === 0) return { ok: true, value: parsed as T };
    failures.push(...contractErrors);
  }

  return {
    ok: false,
    errors: [...new Set(failures)].slice(0, 16),
  };
}

function normalizedResources(
  lane: ImplementationPlan["waves"][number]["lanes"][number],
): string[] {
  return [...lane.scope, ...lane.claimedFilesOrContracts]
    .map((resource) => resource.trim().replaceAll("\\", "/").toLowerCase())
    .filter(
      (resource) =>
        resource.length > 0 && !resource.startsWith("docs/tasks/"),
    );
}

function parallelLaneConflicts(
  wave: ImplementationPlan["waves"][number],
): string[] {
  if (!wave.parallel || wave.lanes.length < 2) return [];
  const errors: string[] = [];
  const owners = new Map<string, string>();
  for (const lane of wave.lanes) {
    if (lane.isolation !== "worktree") {
      errors.push(
        `Wave ${wave.id} lane ${lane.id} must use worktree isolation because the wave is parallel.`,
      );
    }
    for (const resource of normalizedResources(lane)) {
      const owner = owners.get(resource);
      if (owner && owner !== lane.id) {
        errors.push(
          `Wave ${wave.id} parallel lanes ${owner} and ${lane.id} both claim ${resource}.`,
        );
      } else {
        owners.set(resource, lane.id);
      }
    }
  }
  return errors;
}

function planIdentityErrors(
  plan: ImplementationPlan,
  waveIds: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const wave of plan.waves) {
    if (waveIds.has(wave.id)) errors.push(`Duplicate wave id: ${wave.id}.`);
    waveIds.add(wave.id);
    const laneIds = new Set<string>();
    for (const lane of wave.lanes) {
      if (laneIds.has(lane.id))
        errors.push(`Wave ${wave.id} has duplicate lane id ${lane.id}.`);
      laneIds.add(lane.id);
      for (const scopedPath of lane.scope) {
        const isUnsafe =
          scopedPath.startsWith("/") ||
          scopedPath.split(/[\\/]/).includes("..");
        if (isUnsafe) {
          errors.push(
            `Wave ${wave.id} lane ${lane.id} has unsafe scope path ${scopedPath}.`,
          );
        }
      }
    }
    errors.push(...parallelLaneConflicts(wave));
  }
  return errors;
}

function dependencyErrors(
  plan: ImplementationPlan,
  waveIds: Set<string>,
): string[] {
  const errors: string[] = [];
  const incoming = new Map(plan.waves.map((wave) => [wave.id, 0]));
  const outgoing = new Map(plan.waves.map((wave) => [wave.id, [] as string[]]));
  for (const wave of plan.waves) {
    const dependencies = new Set<string>();
    for (const dependency of wave.dependsOn) {
      if (dependency === wave.id) {
        errors.push(`Wave ${wave.id} cannot depend on itself.`);
      } else if (!waveIds.has(dependency)) {
        errors.push(`Wave ${wave.id} depends on unknown wave ${dependency}.`);
      } else if (dependencies.has(dependency)) {
        errors.push(`Wave ${wave.id} repeats dependency ${dependency}.`);
      } else {
        dependencies.add(dependency);
        incoming.set(wave.id, (incoming.get(wave.id) ?? 0) + 1);
        outgoing.get(dependency)?.push(wave.id);
      }
    }
  }

  const ready: string[] = [];
  for (const [waveId, count] of incoming) {
    if (count === 0) ready.push(waveId);
  }
  let visited = 0;
  while (ready.length > 0) {
    const waveId = ready.shift();
    if (!waveId) break;
    visited += 1;
    for (const dependent of outgoing.get(waveId) ?? []) {
      const count = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  const hasUnknownDependency = errors.some((error) =>
    error.includes("unknown wave"),
  );
  if (visited !== plan.waves.length && !hasUnknownDependency) {
    errors.push("Wave dependencies contain a cycle.");
  }
  return errors;
}

function reviewResponseErrors(
  plan: ImplementationPlan,
  waveIds: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const response of plan.reviewResponse) {
    for (const waveId of response.addressedByWaveIds) {
      if (!waveIds.has(waveId)) {
        errors.push(
          `Review response for ${response.finding} references unknown wave ${waveId}.`,
        );
      }
    }
  }
  return errors;
}

export function planSemanticErrors(plan: ImplementationPlan): string[] {
  const waveIds = new Set<string>();
  return [
    ...new Set([
      ...planIdentityErrors(plan, waveIds),
      ...dependencyErrors(plan, waveIds),
      ...reviewResponseErrors(plan, waveIds),
    ]),
  ];
}

export function compileResearchBrief(
  markdown: string,
): CompilationResult<ResearchBrief> {
  return compileMarkdownObject<ResearchBrief>(
    markdown,
    researchBriefSchema,
    () => [],
  );
}

export function compileImplementationPlan(
  markdown: string,
): CompilationResult<ImplementationPlan> {
  return compileMarkdownObject<ImplementationPlan>(
    markdown,
    planSchema,
    planSemanticErrors,
  );
}

export function validateImplementationPlan(
  value: unknown,
): CompilationResult<ImplementationPlan> {
  if (!Value.Check(planSchema, value)) {
    return { ok: false, errors: schemaErrors(planSchema, value) };
  }
  const errors = planSemanticErrors(value as ImplementationPlan);
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value as ImplementationPlan };
}
