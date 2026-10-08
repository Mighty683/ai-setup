/** Per-mission Git isolation. Only an explicitly confirmed final action can merge into the original branch. */
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { safePath, type MissionWorktree } from "./state.ts";

export interface MergeApproval { candidateHead: string; sourceHead: string }
class GitOperationUnresolved extends Error {}

const GIT_OPTIONS = { encoding: "utf8" as const, timeout: 60_000, maxBuffer: 4_000_000,
  env: { ...process.env, GIT_MERGE_AUTOEDIT: "no", GIT_TERMINAL_PROMPT: "0" } };

export class MissionWorktrees {
  constructor(private readonly root: string) {}

  private run(cwd: string, args: string[], optional = false): string {
    const result = spawnSync("git", args, { cwd, ...GIT_OPTIONS });
    if (!optional && (result.error || result.signal)) throw new GitOperationUnresolved("Git ownership is unresolved. Inspect Git and its recorded lock before retrying.");
    if (result.status !== 0 && !optional) throw new Error(result.error?.message ?? (result.stderr.trim() || result.stdout.trim() || "Git operation failed. Inspect the repository before retrying."));
    return result.status === 0 ? result.stdout.trim() : "";
  }

  private runAsync(cwd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd, ...GIT_OPTIONS }, (error, stdout, stderr) => {
        if (error?.killed || error?.signal) return reject(new GitOperationUnresolved("Git did not finish normally. Its ownership lock is retained; inspect before retrying."));
        if (error) return reject(new Error(stderr.trim() || stdout.trim() || error.message));
        resolve();
      });
    });
  }

  private ancestor(cwd: string, ancestor: string, descendant: string): boolean {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd, ...GIT_OPTIONS });
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    throw new GitOperationUnresolved("Git ancestry cannot be proven. Inspect before retrying.");
  }

  private clean(cwd: string, artifacts = false): void {
    if (this.run(cwd, ["diff", "--cached", "--name-only"])) throw new Error("Staged changes must be committed or unstaged before this operation.");
    const paths = artifacts ? ["--", ".", ":(exclude)docs/tasks"] : [];
    if (this.run(cwd, ["status", "--porcelain", "--untracked-files=all", ...paths])) {
      throw new Error("Checkout has uncommitted changes. Commit or preserve them yourself; the workflow never stashes, resets, or guesses a baseline.");
    }
  }

  private directory(taskId: string): string {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(taskId)) throw new Error("Invalid mission identity.");
    const project = createHash("sha256").update(this.root).digest("hex").slice(0, 12);
    const directory = join(realpathSync(homedir()), ".local", "share", "pi", "complex-work", "worktrees", project, taskId);
    if (!relative(this.root, directory).startsWith("..")) throw new Error("Worktree storage must be outside the original project.");
    return directory;
  }

  private identity(worktree: MissionWorktree): void {
    const taskId = worktree.branch.replace(/^complex-work\//, "");
    if (worktree.branch !== `complex-work/${taskId}` || worktree.directory !== this.directory(taskId)) throw new Error("Mission worktree identity changed.");
    safePath(worktree.directory);
  }

  prepare(taskId: string): MissionWorktree {
    if (!/^[a-f\d-]{36}$/i.test(taskId)) throw new Error("Invalid mission identity.");
    const baseBranch = this.run(this.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!baseBranch) throw new Error("Start from an attached Git branch, not a detached HEAD.");
    this.clean(this.root, true);
    const baseCommit = this.run(this.root, ["rev-parse", "HEAD"]);
    return { directory: this.directory(taskId), branch: `complex-work/${taskId}`, baseBranch, baseCommit };
  }

  ensure(worktree: MissionWorktree): void {
    this.identity(worktree);
    if (!existsSync(worktree.directory)) {
      const parent = join(worktree.directory, "..");
      safePath(parent);
      mkdirSync(parent, { recursive: true });
      this.run(this.root, ["worktree", "add", "-b", worktree.branch, worktree.directory, worktree.baseCommit]);
    }
    this.verify(worktree);
  }

  verify(worktree: MissionWorktree): void {
    this.identity(worktree);
    if (!existsSync(worktree.directory)) throw new Error("Mission worktree is missing. Restore it explicitly; do not launch a replacement writer.");
    const common = (cwd: string) => realpathSync(this.run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
    if (common(this.root) !== common(worktree.directory)) throw new Error("Mission worktree belongs to a different repository.");
    if (this.run(worktree.directory, ["rev-parse", "--show-toplevel"]) !== worktree.directory) throw new Error("Mission working directory changed.");
    if (this.run(worktree.directory, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== worktree.branch) throw new Error("Mission worktree branch changed. Inspect before proceeding.");
    if (!this.ancestor(worktree.directory, worktree.baseCommit, "HEAD")) throw new Error("Mission history no longer descends from its approved baseline.");
  }

  approval(worktree: MissionWorktree): MergeApproval {
    this.verify(worktree);
    this.clean(worktree.directory);
    if (this.run(this.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== worktree.baseBranch) throw new Error("Return the original checkout to the mission's original branch before merging.");
    const candidateHead = this.run(worktree.directory, ["rev-parse", "HEAD"]);
    if (worktree.validatedHead !== candidateHead) throw new Error("Candidate changed after test acceptance. Return to review/tests and approve the current committed candidate.");
    if (this.run(worktree.directory, ["diff", "--name-only", `${worktree.baseCommit}..${candidateHead}`, "--", "docs/tasks"])) throw new Error("Candidate changes workflow-owned task records. Repair those changes before merging.");
    return { candidateHead, sourceHead: this.run(this.root, ["rev-parse", "HEAD"]) };
  }

  candidateHead(worktree: MissionWorktree): string {
    this.verify(worktree);
    this.clean(worktree.directory);
    return this.run(worktree.directory, ["rev-parse", "HEAD"]);
  }

  /** An interrupted Git process retains the lock. Ordinary failures release it but never reset merge conflicts. */
  async merge(worktree: MissionWorktree, approved: MergeApproval): Promise<string> {
    const common = this.run(this.root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const lock = join(common, "complex-work-merge-lock");
    safePath(lock);
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A merge transaction is active or interrupted. Inspect its Git lock and owner before manually clearing it; no automatic ownership expiry.");
      throw error;
    }
    let release = true;
    try {
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, branch: worktree.branch, ...approved }), { flag: "wx", mode: 0o600 });
      return await this.mergeLocked(worktree, approved);
    } catch (error) {
      release = !(error instanceof GitOperationUnresolved);
      throw error;
    } finally {
      if (release) {
        const owner = join(lock, "owner.json");
        safePath(owner);
        if (existsSync(owner)) unlinkSync(owner);
        rmdirSync(lock);
      }
    }
  }

  private async mergeLocked(worktree: MissionWorktree, approved: MergeApproval): Promise<string> {
    const current = this.approval(worktree);
    if (current.candidateHead !== approved.candidateHead || current.sourceHead !== approved.sourceHead) throw new Error("Git history changed. Refresh the workspace and confirm the merge again.");
    const inProgress = this.run(this.root, ["rev-parse", "--quiet", "--verify", "MERGE_HEAD"], true);
    if (inProgress) throw new Error("A merge is in progress. Resolve its conflicts in normal Pi, commit the merge, then return here to finish. No task was closed.");
    this.clean(this.root, true);
    if (!this.ancestor(this.root, approved.candidateHead, "HEAD")) {
      await this.runAsync(this.root, ["merge", "--no-ff", "--no-edit", approved.candidateHead]);
    }
    this.clean(this.root, true);
    if (this.run(this.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== worktree.baseBranch) throw new Error("Original branch changed during merge. Task remains open; inspect Git.");
    const head = this.run(this.root, ["rev-parse", "HEAD"]);
    if (!this.ancestor(this.root, approved.candidateHead, head)) throw new Error("Merge ancestry is unproven. Task remains open; inspect Git before retrying.");
    return head;
  }
}
