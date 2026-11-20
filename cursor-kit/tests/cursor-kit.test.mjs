// Run with:  cd cursor-kit && npm test   (or: node --test tests/*.test.mjs)
// Drives the plugin through a fake DSH context; needs git and bash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const kitHome = mkdtempSync(join(tmpdir(), "cursor-kit-home-"));
process.env.DSH_CURSOR_KIT_HOME = kitHome; // must be set before the plugin is imported
const { apply } = await import("../index.mjs");

function setup() {
  const handlers = {};
  const commands = {};
  apply({
    logger: { info() {}, warn() {} },
    on: (name, fn) => { handlers[name] = fn; },
    effect: (gen) => { for (const _ of gen()); },
    commands: { register: (def) => { commands[def.name] = def; return () => {}; } },
  }, {});
  const dir = mkdtempSync(join(tmpdir(), "cursor-kit-proj-"));
  const session = { id: `S-${Math.random().toString(36).slice(2)}`, header: { cwd: dir } };
  const agent = { session };
  const write = (f, s) => { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), s); };
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
  const run = async (name, rawInput = "") =>
    (await commands[name].handler({ agent, rawInput, signal: new AbortController().signal })).text;
  const turn = async (n) => {
    handlers["session/event"](session, { type: "turn/start", data: { turn: n } });
    await handlers["tools/pre-execute"]({ agent }, async () => undefined);
  };
  const postEdit = (name, file) =>
    handlers["tools/post-execute"]({ name, arguments: { file_path: file }, agent }, { content: [] }, async () => ({ kind: "accept" }));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { dir, write, read, run, turn, postEdit, cleanup };
}

test("/rewind undoes the whole last turn, and the rewind itself can be undone", async () => {
  const t = setup();
  try {
    t.write("a.py", "a0"); t.write("keep.txt", "k0");
    await t.turn(1);
    t.write("a.py", "a1"); t.write("new.py", "n1"); unlinkSync(join(t.dir, "keep.txt"));
    const out = await t.run("rewind");
    assert.match(out, /第 1 轮开始前/);
    assert.equal(t.read("a.py"), "a0");
    assert.equal(t.read("new.py"), null);
    assert.equal(t.read("keep.txt"), "k0");
    await t.run("rewind", "2"); // #2 is the pre-rewind snapshot
    assert.equal(t.read("a.py"), "a1");
    assert.equal(t.read("new.py"), "n1");
  } finally { t.cleanup(); }
});

test("/rewind <file> only touches that file; directories and stable numbers work", async () => {
  const t = setup();
  try {
    t.write("a.py", "a0"); t.write("b.py", "b0"); t.write("src/util.py", "u0"); t.write("lib/util.py", "L0");
    await t.turn(1);
    t.write("a.py", "a1"); t.write("b.py", "b1"); t.write("c.py", "c1"); t.write("src/util.py", "u1"); t.write("lib/util.py", "L1");
    await t.turn(2);
    t.write("a.py", "a2");

    const list = await t.run("checkpoints");
    assert.match(list, /#2 .*第 2 轮开始前/);
    assert.match(list, /这一轮改了：a\.py\n/);

    await t.run("rewind", "1 b.py c.py");
    assert.equal(t.read("b.py"), "b0");
    assert.equal(t.read("c.py"), null);
    assert.equal(t.read("a.py"), "a2", "other files untouched");

    assert.match(await t.run("rewind", "1 util.py"), /匹配到多个文件/);
    assert.match(await t.run("rewind", "nope.py"), /没有变化/);

    await t.run("rewind", "1 src/");
    assert.equal(t.read("src/util.py"), "u0");
    assert.equal(t.read("lib/util.py"), "L1");

    await t.run("rewind", "a.py"); // no number: last turn only
    assert.equal(t.read("a.py"), "a1");
  } finally { t.cleanup(); }
});

test("lint appends problems after a bad edit and stays silent after a good one", async () => {
  const t = setup();
  try {
    t.write("bad.json", "{oops");
    const bad = await t.postEdit("write", "bad.json");
    assert.equal(bad.kind, "accept");
    assert.match(bad.content.at(-1).text, /\[cursor-kit lint\]/);

    t.write("bad.sh", "if then fi");
    assert.match((await t.postEdit("edit", "bad.sh")).content.at(-1).text, /bad\.sh/);

    t.write("good.json", "{\"ok\": true}");
    assert.deepEqual(await t.postEdit("write", "good.json"), { kind: "accept" });

    assert.deepEqual(await t.postEdit("read", "bad.json"), { kind: "accept" }, "only write/edit are checked");
  } finally { t.cleanup(); }
});

test("checkpoints are kept outside the project and never touch the project's .git", async () => {
  const t = setup();
  try {
    t.write("x.txt", "1");
    await t.turn(1);
    assert.equal(existsSync(join(t.dir, ".git")), false);
    assert.ok(existsSync(join(kitHome, "checkpoints")));
  } finally { t.cleanup(); }
});

process.on("exit", () => rmSync(kitHome, { recursive: true, force: true }));
