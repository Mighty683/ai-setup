import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

type CollisionPolicy = "skip" | "suffix";

type MigratorConfig = {
  enabled: boolean;
  sourcePath: string;
  outputDir: string;
  namePrefix: string;
  collisionPolicy: CollisionPolicy;
  managedHeader: string;
  lastSourceHash: string;
  generatedFiles: string[];
};

type OpenCodeAgent = {
  role?: string;
  model?: string;
  prompt?: string;
  mode?: string;
  permission?: Record<string, unknown>;
};

type Summary = {
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: number;
  message: string;
};

const DEFAULT_CONFIG: MigratorConfig = {
  enabled: true,
  sourcePath: "../opencode.json",
  outputDir: "agents",
  namePrefix: "opencode-",
  collisionPolicy: "suffix",
  managedHeader: "<!-- managed-by: opencode-migrator -->",
  lastSourceHash: "",
  generatedFiles: [],
};

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    if (!["startup", "reload", "new", "resume", "fork"].includes(event.reason)) return;
    const summary = await runMigration(ctx.cwd, false);
    if (summary.errors > 0) {
      ctx.ui.notify(`OpenCode migrator: ${summary.message}`, "error");
    }
  });

  pi.registerCommand("opencode-migrate", {
    description: "Migrate ../opencode.json agents into ./agents",
    handler: async (args, ctx) => {
      const parts = (args ?? "").split(/\s+/).filter(Boolean);
      const dryRun = parts.includes("--dry-run");
      const statusOnly = parts.includes("--status");

      if (statusOnly) {
        const loaded = await loadConfig(ctx.cwd);
        ctx.ui.notify(
          `enabled=${loaded.config.enabled} source=${loaded.config.sourcePath} output=${loaded.config.outputDir} generated=${loaded.config.generatedFiles.length}`,
          "info",
        );
        return;
      }

      const summary = await runMigration(ctx.cwd, dryRun, true);
      ctx.ui.notify(summary.message, summary.errors > 0 ? "error" : "success");
    },
  });
}

async function runMigration(cwd: string, dryRun: boolean, force = false): Promise<Summary> {
  const summary: Summary = { created: 0, updated: 0, skipped: 0, deleted: 0, errors: 0, message: "" };

  try {
    const loaded = await loadConfig(cwd);
    const configPath = loaded.path;
    const config = loaded.config;

    if (!config.enabled) {
      summary.message = "OpenCode migrator disabled in config.";
      return summary;
    }

    const sourcePath = path.resolve(cwd, config.sourcePath);
    const outputDir = path.resolve(cwd, config.outputDir);

    const sourceRaw = await fs.readFile(sourcePath, "utf8");
    const sourceHash = hash(sourceRaw);
    if (!force && !dryRun && config.lastSourceHash === sourceHash) {
      summary.message = "No changes in source; migration skipped.";
      return summary;
    }

    const parsed = JSON.parse(sourceRaw) as { agent?: Record<string, OpenCodeAgent> };
    if (!parsed.agent || typeof parsed.agent !== "object") {
      summary.errors += 1;
      summary.message = "Invalid opencode.json: missing 'agent' object.";
      return summary;
    }

    await fs.mkdir(outputDir, { recursive: true });

    const used = new Set<string>();
    const generatedNow: string[] = [];
    const entries = Object.entries(parsed.agent);

    for (const [rawName, agent] of entries) {
      const normalized = normalizeAgent(rawName, agent);
      const fileName = chooseFileName(normalized.name, config, used);
      used.add(fileName);
      const absolutePath = path.join(outputDir, fileName);
      const relPath = path.relative(cwd, absolutePath);
      const markdown = renderAgentMarkdown(normalized, config);

      generatedNow.push(relPath);

      let existing = "";
      try {
        existing = await fs.readFile(absolutePath, "utf8");
      } catch {
        // ignore missing
      }

      if (existing === markdown) {
        summary.skipped += 1;
        continue;
      }

      if (!dryRun) {
        await fs.writeFile(absolutePath, markdown, "utf8");
      }

      if (existing) summary.updated += 1;
      else summary.created += 1;
    }

    const previous = new Set(config.generatedFiles);
    for (const rel of previous) {
      if (generatedNow.includes(rel)) continue;
      const abs = path.resolve(cwd, rel);
      try {
        const content = await fs.readFile(abs, "utf8");
        if (!content.startsWith(config.managedHeader)) continue;
        if (!dryRun) await fs.unlink(abs);
        summary.deleted += 1;
      } catch {
        // ignore
      }
    }

    if (!dryRun) {
      const nextConfig: MigratorConfig = {
        ...config,
        lastSourceHash: sourceHash,
        generatedFiles: generatedNow.sort(),
      };
      await writeConfig(configPath, nextConfig);
    }

    summary.message = `OpenCode migration: created=${summary.created}, updated=${summary.updated}, skipped=${summary.skipped}, deleted=${summary.deleted}, errors=${summary.errors}${dryRun ? " (dry-run)" : ""}`;
    return summary;
  } catch (error) {
    summary.errors += 1;
    summary.message = `OpenCode migration failed: ${(error as Error).message}`;
    return summary;
  }
}

function normalizeAgent(name: string, agent: OpenCodeAgent) {
  const descriptionParts = [agent.role, agent.mode].filter(Boolean);
  return {
    name,
    description: descriptionParts.length ? `Imported from OpenCode (${descriptionParts.join(", ")})` : "Imported from OpenCode",
    model: agent.model?.trim() || undefined,
    prompt: agent.prompt?.trim() || "You are an imported OpenCode agent.",
    tools: deriveTools(agent.permission),
  };
}

function deriveTools(permission: Record<string, unknown> | undefined): string[] | undefined {
  if (!permission || typeof permission !== "object") return undefined;
  const mapped: string[] = [];
  const allowMap: Record<string, string> = {
    bash: "bash",
    read: "read",
    write: "write",
    edit: "edit",
    find: "find",
    grep: "grep",
    ls: "ls",
  };

  for (const [k, v] of Object.entries(allowMap)) {
    if ((permission as Record<string, unknown>)[k] === "allow") mapped.push(v);
  }

  return mapped.length ? mapped : undefined;
}

function chooseFileName(name: string, config: MigratorConfig, used: Set<string>): string {
  const base = slug(`${config.namePrefix}${name}`) || `${config.namePrefix}agent`;
  let candidate = `${base}.md`;
  if (config.collisionPolicy === "skip") return candidate;

  let i = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${i}.md`;
    i += 1;
  }
  return candidate;
}

function renderAgentMarkdown(
  agent: { name: string; description: string; model?: string; prompt: string; tools?: string[] },
  config: MigratorConfig,
): string {
  const lines: string[] = [
    config.managedHeader,
    "---",
    `name: ${yamlString(agent.name)}`,
    `description: ${yamlString(agent.description)}`,
  ];

  if (agent.model) lines.push(`model: ${yamlString(agent.model)}`);
  if (agent.tools?.length) lines.push(`tools: [${agent.tools.map(yamlString).join(", ")}]`);

  lines.push("---", "", agent.prompt.trim(), "");
  return `${lines.join("\n")}`;
}

async function loadConfig(cwd: string): Promise<{ path: string; config: MigratorConfig }> {
  const configPath = path.resolve(cwd, "extensions/opencode-migrator/config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MigratorConfig>;

    const config: MigratorConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      generatedFiles: Array.isArray(parsed.generatedFiles) ? parsed.generatedFiles : [],
    };
    return { path: configPath, config };
  } catch {
    await writeConfig(configPath, DEFAULT_CONFIG);
    return { path: configPath, config: { ...DEFAULT_CONFIG } };
  }
}

async function writeConfig(configPath: string, config: MigratorConfig): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
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

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
