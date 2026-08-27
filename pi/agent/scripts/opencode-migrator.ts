import { promises as fs } from "node:fs";
import path from "node:path";

type OpenCodeAgent = {
  role?: string;
  model?: string;
  prompt?: string;
  mode?: string;
  permission?: Record<string, unknown>;
};

type PiAgent = {
  name: string;
  description: string;
  model?: string;
  prompt: string;
  tools?: string[];
  extensions?: string[];
  maxSubagentDepth: number;
};

const MANAGED_HEADER = "<!-- managed-by: opencode-migrator -->";
const OUTPUT_DIR = "agents";
const NAME_PREFIX = "opencode-";

async function main() {
  const sourceArg = process.argv[2];
  if (!sourceArg) {
    console.error("Usage: pnpm opencode:migrate <path-to-opencode.json>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const sourcePath = path.resolve(cwd, sourceArg);
  const outputDir = path.resolve(cwd, OUTPUT_DIR);

  const sourceRaw = await fs.readFile(sourcePath, "utf8");
  const parsed = JSON.parse(sourceRaw) as { agent?: Record<string, OpenCodeAgent> };

  if (!parsed.agent || typeof parsed.agent !== "object") {
    throw new Error("Invalid opencode.json: missing 'agent' object");
  }

  await fs.mkdir(outputDir, { recursive: true });

  const used = new Set<string>();
  const generated = new Set<string>();

  for (const [rawName, agent] of Object.entries(parsed.agent)) {
    const normalized = normalizeAgent(rawName, agent);
    const fileName = chooseFileName(normalized.name, used);
    const absolutePath = path.join(outputDir, fileName);
    const markdown = renderAgentMarkdown(normalized);

    await fs.writeFile(absolutePath, markdown, "utf8");
    generated.add(fileName);
    console.log(`wrote ${path.relative(cwd, absolutePath)}`);
  }

  const existingFiles = await fs.readdir(outputDir);
  for (const file of existingFiles) {
    if (!file.endsWith(".md") || generated.has(file)) continue;

    const abs = path.join(outputDir, file);
    const content = await fs.readFile(abs, "utf8");
    if (!content.startsWith("---\n") || (!content.includes(MANAGED_HEADER) && !content.includes("Imported from OpenCode"))) continue;

    await fs.unlink(abs);
    console.log(`deleted ${path.relative(cwd, abs)}`);
  }
}

function normalizeAgent(name: string, agent: OpenCodeAgent) {
  const descriptionParts = [agent.role, agent.mode].filter(Boolean);
  const delegationAllowed = allowsTaskDelegation(agent.permission);
  return {
    name,
    description: descriptionParts.length ? `Imported from OpenCode (${descriptionParts.join(", ")})` : "Imported from OpenCode",
    model: agent.model?.trim() || undefined,
    prompt: agent.prompt?.trim() || "You are an imported OpenCode agent.",
    tools: deriveTools(agent.permission),
    // pi-subagents is an extension tool, not a builtin tool. Disabling normal
    // extensions is the only available mechanical way to omit it for a child.
    extensions: delegationAllowed ? undefined : [],
    // Allows Pi -> Seargant -> Frontline -> Luna, but no deeper recursion.
    maxSubagentDepth: delegationAllowed ? 3 : 0,
  };
}

function deriveTools(permission: Record<string, unknown> | undefined): string[] | undefined {
  const readOnlyTools = ["bash", "read", "find", "grep", "ls"];
  const standardTools = [...readOnlyTools, "write", "edit"];
  if (!permission || typeof permission !== "object") return standardTools;

  if (permission.edit === "deny") return readOnlyTools;

  const allowMap: Record<string, string> = {
    bash: "bash",
    read: "read",
    write: "write",
    edit: "edit",
    find: "bash",
    grep: "bash",
    ls: "bash",
  };

  const tools = new Set<string>();
  for (const [key, value] of Object.entries(allowMap)) {
    if ((permission as Record<string, unknown>)[key] === "allow") tools.add(value);
  }

  return tools.size ? [...tools] : standardTools;
}

function allowsTaskDelegation(permission: Record<string, unknown> | undefined): boolean {
  const task = permission?.task;
  if (task === "allow") return true;
  if (!task || typeof task !== "object") return false;

  return Object.values(task as Record<string, unknown>).some((value) => value === "allow");
}

function chooseFileName(name: string, used: Set<string>): string {
  const base = slug(`${NAME_PREFIX}${name}`) || `${NAME_PREFIX}agent`;
  let candidate = `${base}.md`;
  let i = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${i}.md`;
    i += 1;
  }

  used.add(candidate);
  return candidate;
}

function renderAgentMarkdown(agent: PiAgent): string {
  const lines: string[] = [
    "---",
    `name: ${yamlString(agent.name)}`,
    `description: ${yamlString(agent.description)}`,
  ];

  if (agent.model) lines.push(`model: ${yamlString(agent.model)}`);
  if (agent.tools?.length) lines.push(`tools: [${agent.tools.map(yamlString).join(", ")}]`);
  if (agent.extensions !== undefined) lines.push("extensions:");
  lines.push(`maxSubagentDepth: ${agent.maxSubagentDepth}`);

  lines.push("---", "", MANAGED_HEADER, "", agent.prompt.trim(), "");
  return `${lines.join("\n")}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(`opencode migration failed: ${(error as Error).message}`);
  process.exit(1);
});
