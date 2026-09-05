// Private Git snapshots: original HEAD/index stay untouched until explicit patch delivery.
import { mkdir, writeFile, readFile, lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { pathAllowed, type Resource } from "../complex-work-contracts.ts";
import { runProcess, readJson, atomicJson } from "./io.ts";

export type Workspace = { root: string; source: string; repo: string; baseline: string; head: string };
const identity = { GIT_AUTHOR_NAME: "Complex Work", GIT_AUTHOR_EMAIL: "complex-work@localhost", GIT_COMMITTER_NAME: "Complex Work", GIT_COMMITTER_EMAIL: "complex-work@localhost" };
export async function git(cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await runProcess("git", ["-c", "core.hooksPath=/dev/null", ...args], cwd, { input, env: { ...identity, ...env }, strictOutputLimit: 32 * 1024 * 1024 });
  if (result.code !== 0) throw new Error(`git ${args[0]}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
export async function head(cwd: string): Promise<string> { return (await git(cwd, ["rev-parse", "HEAD"])).trim(); }
async function commitIndex(cwd: string, parent: string, message: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const tree = (await git(cwd, ["write-tree"], undefined, env)).trim();
  if (tree === (await git(cwd, ["rev-parse", `${parent}^{tree}`])).trim()) return parent;
  const commit = (await git(cwd, ["commit-tree", tree, "-p", parent], message + "\n", env)).trim();
  await git(cwd, ["update-ref", "HEAD", commit]);
  return commit;
}
/** Capture staged, unstaged and untracked nonignored work using only the private index. */
export async function createWorkspace(sourceCwd: string, root: string): Promise<Workspace> {
  const source = (await git(sourceCwd, ["rev-parse", "--show-toplevel"])).trim();
  const repo = path.join(root, "integration");
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  const canonicalSource = await realpath(source);
  if (canonicalRoot === canonicalSource || canonicalRoot.startsWith(canonicalSource + path.sep)) throw new Error("Mission storage must be outside the source repository");
  await git(root, ["clone", "--shared", "--no-checkout", "--", source, repo]);
  const parent = await head(repo);
  await git(repo, ["read-tree", parent]);
  const env = { GIT_WORK_TREE: source };
  await git(repo, ["add", "-u", "--", ".", ":!.pi/subagents", ":!.pi/complex-work"], undefined, env);
  const names = (await git(source, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".", ":!.pi/subagents", ":!.pi/complex-work"])).split("\0").filter(Boolean);
  const existing: string[] = [];
  for (const file of new Set(names)) {
    try { await lstat(path.join(source, file)); existing.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (existing.length) await git(repo, ["--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"], existing.join("\0") + "\0", env);
  const index = await git(repo, ["ls-files", "--stage"]);
  if (index.split("\n").some(line => line.startsWith("160000 "))) throw new Error("Complex work currently requires a repository without submodules.");
  const baseline = await commitIndex(repo, parent, "Complex-work input snapshot");
  await git(repo, ["checkout", "--detach", "--force", baseline]);
  return { root, source, repo, baseline, head: baseline };
}
export async function createCheckout(workspace: Workspace, name: string, base: string): Promise<string> {
  const cwd = path.join(workspace.root, "checkouts", name);
  await mkdir(path.dirname(cwd), { recursive: true });
  try {
    await lstat(path.join(cwd, ".git"));
    if ((await git(cwd, ["remote", "get-url", "origin"])).trim() !== workspace.repo) throw new Error("Checkout ownership mismatch");
    return cwd;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await git(workspace.root, ["clone", "--shared", "--no-checkout", "--", workspace.repo, cwd]);
  await git(cwd, ["checkout", "--detach", base]);
  return cwd;
}
export async function checkpoint(cwd: string, message: string): Promise<string> {
  const parent = await head(cwd);
  await git(cwd, ["add", "-A", "--", ".", ":!.pi/subagents", ":!.pi/complex-work"]);
  return commitIndex(cwd, parent, message);
}
/** NUL-separated names include deletes, renames (as delete/add), and untracked files after checkpointing. */
export async function changedFiles(cwd: string, from: string, to: string): Promise<string[]> {
  return (await git(cwd, ["diff", "--no-renames", "--name-only", "-z", from, to])).split("\0").filter(Boolean);
}
export async function assertScope(cwd: string, from: string, to: string, resources: Resource[], record: string): Promise<string[]> {
  const files = await changedFiles(cwd, from, to);
  const outside = files.filter(file => file !== record && (file.startsWith("docs/tasks/complex-") || !pathAllowed(file, resources)));
  if (outside.length) throw new Error(`Changes outside approved scope: ${outside.join(", ")}`);
  const modes = await git(cwd, ["diff", "--raw", "--no-renames", from, to]);
  if (modes.split("\n").some(line => /^:\d+ (120000|160000) /.test(line))) throw new Error("New symlinks and submodules require a separate explicit change.");
  return files;
}
export async function patch(cwd: string, from: string, to: string): Promise<string> {
  return git(cwd, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-renames", from, to]);
}
/** Apply a reviewed patch to a new private candidate; a failed check cannot corrupt the current checkpoint. */
export async function integrationCandidate(workspace: Workspace, name: string, lane: { cwd: string; base: string; candidate: string }): Promise<string> {
  const cwd = await createCheckout(workspace, name, workspace.head);
  const marker = path.join(workspace.root, "receipts", `${name}.applied.json`);
  if (await readJson(marker)) return cwd;
  const diff = await patch(lane.cwd, lane.base, lane.candidate);
  if (diff) {
    const reverse = await runProcess("git", ["apply", "--reverse", "--check", "--binary", "-"], cwd, { input: diff });
    if (reverse.code !== 0) {
      await git(cwd, ["apply", "--check", "--binary", "-"], diff);
      await git(cwd, ["apply", "--binary", "-"], diff);
    }
  }
  await atomicJson(marker, { base: workspace.head, candidate: lane.candidate });
  return cwd;
}
/** Import the checked candidate's objects before advancing the private integration reference. */
export async function adopt(workspace: Workspace, cwd: string, commit: string): Promise<void> {
  await git(workspace.repo, ["fetch", "--no-tags", "--", cwd, commit]);
  await git(workspace.repo, ["checkout", "--detach", commit]);
}
export async function writeDiff(workspace: Workspace): Promise<string> {
  const file = path.join(workspace.root, "delivery.patch");
  await writeFile(file, await patch(workspace.repo, workspace.baseline, workspace.head));
  return file;
}
/** Refuse delivery if any affected file changed since the captured input, including untracked collisions. */
export async function deliver(workspace: Workspace, signal?: AbortSignal): Promise<void> {
  const file = await writeDiff(workspace);
  const diff = await readFile(file, "utf8");
  if (!diff.trim()) return;
  const files = await changedFiles(workspace.repo, workspace.baseline, workspace.head);
  const current = await Promise.all(files.map(file => sourceBlob(workspace.source, file)));
  const before = await Promise.all(files.map(file => treeBlob(workspace.repo, workspace.baseline, file)));
  const after = await Promise.all(files.map(file => treeBlob(workspace.repo, workspace.head, file)));
  if (current.every((blob, index) => blob === after[index])) return;
  if (current.some((blob, index) => blob !== before[index])) throw new Error("Delivery conflicts with changes made since the input snapshot; the reviewed patch is preserved.");
  await git(workspace.source, ["apply", "--check", "--binary", "-"], diff);
  if (signal?.aborted) throw new Error("Delivery cancelled before applying changes");
  await git(workspace.source, ["apply", "--binary", "-"], diff);
}
async function treeBlob(cwd: string, revision: string, file: string): Promise<string | undefined> {
  const entry = (await git(cwd, ["ls-tree", revision, "--", file])).trim();
  const fields = entry.split(/\s+/);
  return entry ? `${fields[0]}:${fields[2]}` : undefined;
}
async function sourceBlob(cwd: string, file: string): Promise<string | undefined> {
  try {
    const info = await lstat(path.join(cwd, file));
    if (info.isSymbolicLink()) return `120000:${(await git(cwd, ["hash-object", "--stdin"], await readlink(path.join(cwd, file)))).trim()}`;
    if (!info.isFile()) return "not-a-file";
    const mode = info.mode & 0o111 ? "100755" : "100644";
    return `${mode}:${(await git(cwd, ["hash-object", `--path=${file}`, "--", file])).trim()}`;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
