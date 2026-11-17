const { test } = require("node:test");
const assert = require("node:assert/strict");
const G = require("../extension/graph.js");
const { refinementPrompt, validateRefinement } = require("../shared/refinement.cjs");
function setup() {
  const graph = G.empty();
  for (const kind of ["generate", "refine", "prefix", "tasks"])
    G.add(graph, kind, kind, { x: 0, y: 0 });
  G.connect(graph, "refine", "generate", "r");
  G.connect(graph, "prefix", "generate", "p");
  G.connect(graph, "tasks", "generate", "t");
  return graph;
}
function complete(graph, count) {
  const batch = G.beginBatch(graph, "generate");
  batch.running = false;
  batch.items = Array.from({ length: count }, (_, index) => ({
    name: "task" + index, state: "succeeded", path: `image-${index}.png`, prompt: `effective-${index}`
  }));
  return batch;
}
test("first batch and partial batches keep refinement disabled", () => {
  const graph = setup();
  assert.equal(G.refinementState(graph, "refine").ready, false);
  const batch = complete(graph, 10);
  batch.running = true;
  assert.equal(G.refinementState(graph, "refine").ready, false);
  batch.running = false; batch.items[9].state = "failed";
  assert.equal(G.refinementState(graph, "refine").ready, false);
  batch.items[9].state = "succeeded";
  assert.equal(G.refinementState(graph, "refine").ready, true);
});
test("all tasks refine their own latest image and effective prompt, not the original references", () => {
  const graph = setup(), parent = complete(graph, 10);
  graph.nodes.refine.config.text = "改为蓝色";
  graph.nodes.prefix.config.text = "通用要求";
  const plan = G.refinementPlan(graph, "generate", "refine");
  assert.equal(plan.parentBatchId, parent.batchId);
  assert.equal(plan.tasks.length, 10);
  assert.equal(plan.context.prefixes[0], "通用要求");
  plan.tasks.forEach((task, index) => {
    assert.equal(task.images[0].path, `image-${index}.png`);
    assert.equal(task.prompt, `effective-${index}`);
  });
  const next = complete(graph, 10);
  next.items[0].prompt = "已改蓝色";
  assert.equal(G.refinementPlan(graph, "generate", "refine").tasks[0].prompt, "已改蓝色");
});
test("another running batch blocks refinement; restores never imply success", () => {
  const graph = setup(), old = complete(graph, 10);
  complete(graph, 10); old.running = true;
  assert.equal(G.refinementState(graph, "refine").ready, false);
  graph.runs.generate.running = true;
  graph.runs.generate.items[0].state = "running";
  assert.equal(G.refinementState(G.restore(graph), "refine").ready, false);
});
test("refinement wiring has one explicit generator and one card per generator", () => {
  const graph = setup();
  G.add(graph, "g2", "generate", { x: 0, y: 0 });
  G.add(graph, "r2", "refine", { x: 0, y: 0 });
  assert.equal(G.connect(graph, "refine", "g2", "bad"), false);
  assert.equal(G.connect(graph, "r2", "generate", "bad2"), false);
  assert.equal(G.connect(graph, "generate", "refine", "cycle"), false);
});
test("AI receives latest-change priority and strict structured results are required", () => {
  const prompt = refinementPrompt({ previousPrompt: "红色花朵", instructions: "蓝色花朵" });
  assert.match(prompt, /最新修改优先/);
  assert.match(prompt, /红色花朵/); assert.match(prompt, /蓝色花朵/);
  assert.throws(() => validateRefinement({ name: "蓝色花朵", prompt: "蓝色" }));
  assert.deepEqual(validateRefinement({ name: "蓝花", prompt: "改为蓝色", changes: ["颜色"] }),
    { name: "蓝花", prompt: "改为蓝色", changes: ["颜色"] });
  assert.throws(() => refinementPrompt({ previousPrompt: "x".repeat(11000), instructions: "blue" }));
});
