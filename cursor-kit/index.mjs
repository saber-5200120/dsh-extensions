// dsh-cursor-kit — Cursor-style checkpoints/rewind and lint-after-edit for DeepSeek Harness.
// https://github.com/saber-5200120/dsh-extensions · MIT License
//
// 1. Checkpoints: before every top-level agent turn, the session's working
//    directory is snapshotted into a private shadow git repository
//    (~/.dsh-cursor-kit/checkpoints/<hash>.git). The project's own .git is never touched.
//    Slash commands:  /checkpoints  ·  /rewind [n] [files…]
// 2. Lint loop: after the agent's `write` / `edit` tool succeeds, a checker
//    runs on that file; any problems are appended to the tool result so the
//    agent fixes them in the same turn.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

export const name = "cursor-kit";
export const inject = ["commands"];

const HOME = process.env.DSH_CURSOR_KIT_HOME || join(homedir(), ".dsh-cursor-kit");
const CHECKPOINT_ROOT = join(HOME, "checkpoints");
const LOGIN_SHELL = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";

const DEFAULT_EXCLUDES = [
  "node_modules/", ".venv/", "venv/", "__pycache__/", ".mypy_cache/", ".pytest_cache/",
  ".ruff_cache/", ".next/", ".nuxt/", ".turbo/", ".cache/", "dist/", "build/", "target/",
  ".gradle/", ".idea/", ".DS_Store", "*.pyc", "*.log", ".dsh-cursor-kit/",
];

// ---------- small process helpers ----------

function run(file, args, { cwd, env, timeoutMs = 60_000, input } = {}) {
  return new Promise((resolvePromise) => {
    const child = execFile(file, args, {
      cwd, env: { ...process.env, ...env }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolvePromise({
        code: error ? (typeof error.code === "number" ? error.code : -1) : 0,
        stdout: String(stdout ?? ""), stderr: String(stderr ?? ""),
        timedOut: Boolean(error?.killed),
      });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const runShell = (command, cwd, timeoutMs) => run(LOGIN_SHELL, ["-lc", command], { cwd, timeoutMs });

// ---------- checkpoints (shadow git repo per working directory) ----------

class ShadowRepo {
  constructor(workTree, log) {
    this.workTree = workTree;
    this.gitDir = join(CHECKPOINT_ROOT, createHash("sha1").update(workTree).digest("hex").slice(0, 16) + ".git");
    this.log = log;
    this.queue = Promise.resolve();
    this.ready = undefined;
  }

  git(args, opts = {}) {
    return run("git", ["--git-dir", this.gitDir, "--work-tree", this.workTree, ...args], {
      cwd: this.workTree,
      env: { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
      ...opts,
    });
  }

  async must(args, what) {
    const r = await this.git(args);
    if (r.code !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
    return r.stdout;
  }

  /** Serialize every git operation on this repo. */
  exclusive(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  init() {
    this.ready ??= (async () => {
      await mkdir(CHECKPOINT_ROOT, { recursive: true });
      if (!existsSync(join(this.gitDir, "HEAD"))) {
        const r = await run("git", ["init", "--quiet", "--bare", this.gitDir]);
        if (r.code !== 0) throw new Error(`git init failed: ${r.stderr.trim()}`);
      }
      await mkdir(join(this.gitDir, "info"), { recursive: true });
      if (!existsSync(join(this.gitDir, "dsh-worktree"))) {
        await writeFile(join(this.gitDir, "info", "exclude"), DEFAULT_EXCLUDES.join("\n") + "\n");
        await writeFile(join(this.gitDir, "dsh-worktree"), this.workTree + "\n");
      }
      for (const [k, v] of [
        ["core.bare", "false"], ["core.autocrlf", "false"], ["core.hooksPath", "/dev/null"],
        ["core.quotepath", "false"], ["commit.gpgsign", "false"], ["gc.auto", "0"],
        ["user.name", "dsh-cursor-kit"], ["user.email", "checkpoint@localhost"],
      ]) await this.must(["config", k, v], "git config");
    })();
    this.ready.catch(() => { this.ready = undefined; }); // allow a retry after a failed init
    return this.ready;
  }

  /** Record the current state of the working tree. Returns the commit hash. */
  snapshot(label) {
    return this.exclusive(async () => {
      await this.init();
      const add = await this.git(["add", "--all", "--ignore-errors", "--", "."], { timeoutMs: 120_000 });
      if (add.code !== 0 && add.code !== 1) throw new Error(`git add failed: ${add.stderr.trim().slice(0, 500)}`);
      await this.must(["commit", "--quiet", "--allow-empty", "--no-verify", "-m", label], "git commit");
      return (await this.must(["rev-parse", "HEAD"], "git rev-parse")).trim();
    });
  }

  /** Checkpoints whose message contains `session=<id>`, newest first. */
  list(sessionId) {
    return this.exclusive(async () => {
      if (!existsSync(join(this.gitDir, "HEAD"))) return [];
      const r = await this.git(["log", "--format=%H%x09%ct%x09%s", `--grep=session=${sessionId}`, "--fixed-strings"]);
      if (r.code !== 0) return [];
      const rows = r.stdout.split("\n").filter(Boolean);
      // `n` is stable: oldest checkpoint is 1, so new checkpoints never renumber old ones.
      return rows.map((line, i) => {
        const [hash, ct, subject] = line.split("\t");
        const kv = Object.fromEntries(subject.split(" ").filter((p) => p.includes("=")).map((p) => p.split("=")));
        return { n: rows.length - i, hash, time: new Date(Number(ct) * 1000), kind: kv.kind, turn: kv.turn, subject };
      });
    });
  }

  /** Files that differ between commit `from` and commit `to`. */
  changes(from, to) {
    return this.exclusive(async () => {
      const r = await this.git(["diff", "--name-status", "--no-renames", from, to]);
      return r.stdout.split("\n").filter(Boolean).map((l) => {
        const [status, ...rest] = l.split("\t");
        return { status, path: rest.join("\t") };
      });
    });
  }

  /** Tree hash of the working tree right now, without recording a checkpoint. */
  currentTree() {
    return this.exclusive(async () => {
      await this.init();
      const env = { GIT_INDEX_FILE: join(this.gitDir, "index.preview") };
      const opts = { env: { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C", ...env } };
      await this.git(["read-tree", "HEAD"], opts);
      await this.git(["add", "--all", "--ignore-errors", "--", "."], { ...opts, timeoutMs: 120_000 });
      const r = await this.git(["write-tree"], opts);
      return r.code === 0 ? r.stdout.trim() : null;
    });
  }

  /**
   * Make the working tree match `target`: everything tracked by the latest
   * snapshot, or only `paths` (relative to the work tree) when given.
   */
  restore(target, paths = []) {
    return this.exclusive(async () => {
      if (paths.length === 0) {
        await this.must(["restore", `--source=${target}`, "--staged", "--worktree", "--", "."], "git restore");
        return;
      }
      const inTarget = [];
      const notInTarget = [];
      for (const p of paths) {
        const r = await this.git(["cat-file", "-e", `${target}:${p}`]);
        (r.code === 0 ? inTarget : notInTarget).push(p);
      }
      if (inTarget.length > 0) {
        await this.must(["restore", `--source=${target}`, "--staged", "--worktree", "--", ...inTarget], "git restore");
      }
      for (const p of notInTarget) { // created after the checkpoint: remove it
        await this.git(["rm", "--quiet", "--cached", "--ignore-unmatch", "--", p]);
        await rm(join(this.workTree, p), { force: true });
      }
    });
  }
}

// ---------- lint after edit ----------

async function which(cmd, cwd) {
  const r = await runShell(`command -v ${cmd}`, cwd, 10_000);
  return r.code === 0 ? r.stdout.trim().split("\n").pop() : null;
}

async function findUp(start, stop, names) {
  let dir = start;
  for (;;) {
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
    if (dir === stop || dir === resolve(dir, "..")) return null;
    dir = resolve(dir, "..");
  }
}

/** Project override: <cwd>/.dsh/lint.json  { "*.py": "ruff check {file}", ".ts": "npx eslint {file}" } */
async function projectLintCommand(cwd, file) {
  const cfgPath = join(cwd, ".dsh", "lint.json");
  if (!existsSync(cfgPath)) return undefined;
  try {
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    const ext = extname(file);
    for (const [pattern, command] of Object.entries(cfg)) {
      const p = pattern.replace(/^\*/, "");
      if (p === ext || file.endsWith(p)) return command; // null/"" disables
    }
  } catch { /* ignore broken config */ }
  return undefined;
}

async function defaultLintCommand(cwd, file) {
  const ext = extname(file).toLowerCase();
  const dir = resolve(file, "..");
  switch (ext) {
    case ".py":
      if (await which("ruff", cwd)) return "ruff check --output-format concise --no-fix --no-cache {file}";
      return "python3 -m py_compile {file}";
    case ".js": case ".mjs": case ".cjs": case ".jsx": case ".ts": case ".tsx": case ".mts": case ".cts": {
      const eslint = await findUp(dir, cwd, ["node_modules/.bin/eslint"]);
      if (eslint) return `${shellQuote(eslint)} --format unix {file}`;
      if ([".js", ".mjs", ".cjs"].includes(ext)) return "node --check {file}";
      return null;
    }
    case ".json": return "__json__";
    case ".sh": case ".bash": return "bash -n {file}";
    case ".zsh": return "zsh -n {file}";
    case ".go": return (await which("gofmt", cwd)) ? "gofmt -e -l {file} >/dev/null" : null;
    case ".rb": return "ruby -wc {file} >/dev/null";
    case ".php": return (await which("php", cwd)) ? "php -l {file}" : null;
    default: return null;
  }
}

async function lintFile(cwd, file, timeoutMs) {
  let command = await projectLintCommand(cwd, file);
  if (command === undefined) command = await defaultLintCommand(cwd, file);
  if (!command) return null;
  if (command === "__json__") {
    try { JSON.parse(await readFile(file, "utf8")); return null; } catch (e) { return { command: "JSON.parse", output: e.message }; }
  }
  const full = command.replaceAll("{file}", shellQuote(file));
  const r = await runShell(full, cwd, timeoutMs);
  if (r.timedOut) return null;
  if (r.code === 0) return null;
  const output = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
  if (!output) return null;
  return { command: full, output };
}

// ---------- plugin ----------

const eligibleCwd = (session) => {
  const h = session?.header;
  if (!h || h.origin === "subagent" || (h.delegationDepth ?? 0) > 0) return undefined;
  return h.cwd;
};

const fmtTime = (d) => d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function apply(ctx, config = {}) {
  const cfg = {
    checkpoints: config.checkpoints !== false,
    lint: config.lint !== false,
    lintTimeoutMs: config.lintTimeoutMs ?? 30_000,
    lintMaxChars: config.lintMaxChars ?? 4000,
  };
  const repos = new Map();          // workTree -> ShadowRepo
  const pending = new Map();        // workTree -> Promise of in-flight turn snapshot
  const warn = (m) => ctx.logger?.warn?.(`cursor-kit: ${m}`);

  const repoFor = (cwd) => {
    if (!cwd || cwd === homedir() || cwd === "/") return undefined; // never snapshot the whole home dir
    let repo = repos.get(cwd);
    if (!repo) repos.set(cwd, repo = new ShadowRepo(cwd, warn));
    return repo;
  };

  // --- checkpoint before each top-level turn ---
  if (cfg.checkpoints) {
    ctx.on("session/event", (session, event) => {
      if (event?.type !== "turn/start") return;
      const cwd = eligibleCwd(session);
      const repo = repoFor(cwd);
      if (!repo) return;
      const label = `dsh-checkpoint kind=turn session=${session.id ?? session.header?.id} turn=${event.data?.turn ?? "?"}`;
      const p = repo.snapshot(label).catch((e) => warn(`snapshot of ${cwd} failed: ${e.message}`));
      pending.set(cwd, p);
      p.finally(() => { if (pending.get(cwd) === p) pending.delete(cwd); });
    });

    // Make sure the snapshot is on disk before any tool can modify files.
    ctx.on("tools/pre-execute", async (exec, next) => {
      const cwd = exec?.agent?.session?.header?.cwd;
      if (cwd && pending.has(cwd)) await pending.get(cwd);
      else if (pending.size > 0) await Promise.allSettled([...pending.values()]);
      return next();
    });
  }

  // --- lint after write/edit ---
  if (cfg.lint) {
    ctx.on("tools/post-execute", async (exec, result, next) => {
      const downstream = await next();
      try {
        if (!["write", "edit"].includes(exec?.name) || result?.isError || downstream?.kind === "block") return downstream;
        const raw = exec.arguments?.file_path;
        const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
        if (typeof raw !== "string" || !raw) return downstream;
        const file = isAbsolute(raw) ? raw : resolve(cwd, raw);
        const problem = await lintFile(cwd, file, cfg.lintTimeoutMs);
        if (!problem) return downstream;
        let out = problem.output;
        if (out.length > cfg.lintMaxChars) out = out.slice(0, cfg.lintMaxChars) + `\n… (${problem.output.length - cfg.lintMaxChars} more chars truncated)`;
        const note = {
          type: "text",
          text: `\n\n[cursor-kit lint] The file was saved, but the checker reported problems in ${relative(cwd, file) || file}:\n$ ${problem.command}\n${out}\nFix these before moving on (ignore only if they are pre-existing and unrelated to your change).`,
        };
        const base = downstream?.content ?? result.content ?? [];
        return { ...downstream, kind: "accept", content: [...base, note] };
      } catch (e) {
        warn(`lint failed: ${e.message}`);
        return downstream;
      }
    });
  }

  // --- slash commands ---
  const sessionInfo = (invocation) => {
    const session = invocation.agent?.session;
    return { session, id: session?.id ?? session?.header?.id, cwd: session?.header?.cwd };
  };

  const listCheckpoints = async (invocation) => {
    const { id, cwd } = sessionInfo(invocation);
    const repo = repoFor(cwd);
    if (!repo) return { kind: "error", text: "当前会话没有可用的工作目录（或工作目录是主目录），不记录检查点。" };
    const items = await repo.list(id);
    if (items.length === 0) return { kind: "success", text: "这个会话还没有检查点。agent 每开始一轮前会自动记录一个。" };
    const now = await repo.currentTree();
    const lines = [];
    for (const [i, c] of items.entries()) {
      const what = c.kind === "turn" ? `第 ${c.turn} 轮开始前` : c.kind === "pre-rewind" ? "回滚前的状态（可用来撤销回滚）" : c.kind;
      lines.push(`#${c.n}  ${fmtTime(c.time)}  ${what}`);
      if (c.kind !== "turn") continue;
      // Files this turn changed: from its checkpoint to the next newer one (or to now).
      const after = i === 0 ? now : items[i - 1].hash;
      if (!after) continue;
      const changed = await repo.changes(c.hash, after);
      if (changed.length === 0) { lines.push("     这一轮没有改文件"); continue; }
      lines.push(`     这一轮改了：${changed.slice(0, 8).map((f) => f.path).join("、")}${changed.length > 8 ? ` 等 ${changed.length} 个文件` : ""}`);
    }
    return {
      kind: "success",
      text: `工作目录：${cwd}\n检查点（最新在前）：\n${lines.join("\n")}\n\n/rewind                撤销上一轮的全部改动\n/rewind <编号>         回到指定检查点\n/rewind <文件…>        只撤销这些文件在上一轮的改动\n/rewind <编号> <文件…>  只把这些文件回到指定检查点`,
    };
  };

  /** Match user-typed paths against changed files: exact, then by trailing path, then as a directory. */
  const resolvePaths = (tokens, changed) => {
    const picked = new Set();
    const problems = [];
    for (const raw of tokens) {
      const t = raw.replace(/^\.\//, "").replace(/\/$/, "");
      let hits = changed.filter((c) => c.path === t);
      if (hits.length === 0) hits = changed.filter((c) => c.path.endsWith("/" + t));
      if (hits.length === 0) hits = changed.filter((c) => c.path.startsWith(t + "/"));
      if (hits.length === 0) problems.push(`“${raw}” 自这个检查点以来没有变化（或不存在）`);
      else if (hits.length > 1 && !changed.some((c) => c.path.startsWith(t + "/")))
        problems.push(`“${raw}” 匹配到多个文件：${hits.map((h) => h.path).join("、")}，请写完整路径`);
      else hits.forEach((h) => picked.add(h.path));
    }
    return { paths: [...picked], problems };
  };

  /** Split "/rewind 2 a.py 'my file.txt'" into tokens, honoring simple quotes. */
  const tokenize = (s) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

  const rewind = async (invocation) => {
    const { id, cwd } = sessionInfo(invocation);
    const repo = repoFor(cwd);
    if (!repo) return { kind: "error", text: "当前会话没有可用的工作目录，无法回滚。" };
    const items = await repo.list(id);
    if (items.length === 0) return { kind: "error", text: "这个会话还没有检查点，无法回滚。" };
    const tokens = tokenize(invocation.rawInput.trim());
    let target;
    let fileTokens = tokens;
    if (tokens.length > 0 && /^#?\d+$/.test(tokens[0])) {
      const n = Number(tokens[0].replace("#", ""));
      target = items.find((c) => c.n === n);
      fileTokens = tokens.slice(1);
      if (!target) return { kind: "error", text: `找不到编号 #${n} 的检查点。先用 /checkpoints 查看编号。` };
    } else if (tokens.length === 1 && /^[0-9a-f]{7,40}$/.test(tokens[0]) && items.some((c) => c.hash.startsWith(tokens[0]))) {
      target = items.find((c) => c.hash.startsWith(tokens[0]));
      fileTokens = [];
    } else {
      target = items.find((c) => c.kind === "turn") ?? items[0];
    }

    // Compare without recording anything first, so a typo does not create a checkpoint.
    const now = await repo.currentTree();
    let changed = await repo.changes(target.hash, now ?? "HEAD");
    if (changed.length === 0) return { kind: "success", text: "文件和这个检查点完全一致，无需回滚。" };
    let paths = [];
    if (fileTokens.length > 0) {
      const r = resolvePaths(fileTokens, changed);
      if (r.problems.length > 0) {
        return { kind: "error", text: `${r.problems.join("\n")}\n\n自这个检查点以来改过的文件：\n${changed.slice(0, 40).map((c) => "  " + c.path).join("\n")}` };
      }
      paths = r.paths;
      changed = changed.filter((c) => paths.includes(c.path));
    }

    await repo.snapshot(`dsh-checkpoint kind=pre-rewind session=${id} target=${target.hash.slice(0, 8)}`);
    await repo.restore(target.hash, paths);

    const verb = { A: "删除（检查点之后新建的）", D: "恢复（之后被删掉的）", M: "还原" };
    const shown = changed.slice(0, 40).map((c) => `  ${verb[c.status[0]] ?? c.status}  ${c.path}`);
    if (changed.length > 40) shown.push(`  …另外 ${changed.length - 40} 个文件`);
    const where = target.kind === "turn" ? `第 ${target.turn} 轮开始前` : target.kind === "pre-rewind" ? "上次回滚之前的状态" : target.subject;
    const scope = paths.length > 0 ? `只把 ${changed.length} 个文件` : `把全部 ${changed.length} 个改动的文件`;
    return {
      kind: "success",
      text: `已${scope}回滚到：#${target.n} ${where}（${fmtTime(target.time)}）\n${shown.join("\n")}\n\n只回滚了文件，对话记录不变。想撤销这次回滚：/rewind ${items.length + 1}`,
    };
  };

  ctx.effect(function* () {
    yield ctx.commands.register({
      definitionId: "dsh-cursor-kit/checkpoints",
      name: "checkpoints",
      description: "列出本会话的文件检查点（每轮开始前自动记录）",
      handler: listCheckpoints,
    });
    yield ctx.commands.register({
      definitionId: "dsh-cursor-kit/rewind",
      name: "rewind",
      description: "把文件回滚到某个检查点（不带参数＝撤销上一轮的改动；可只写文件名）",
      input: { hint: "[编号] [文件…]" },
      handler: rewind,
    });
  }, "cursor-kit commands");

  ctx.logger?.info?.(`cursor-kit: loaded (checkpoints=${cfg.checkpoints}, lint=${cfg.lint})`);
}
