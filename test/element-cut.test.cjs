const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({ crypto: require("node:crypto"), structuredClone });
vm.runInContext(fs.readFileSync(require.resolve("../extension/pipeline.js"), "utf8"), context);
const pipeline = context.MakerPipeline;
test("element card only detects and crops original images; retries reuse saved recognition", async () => {
  let record, detects = 0, crops = 0;
  const calls = [], requestIds = [];
  const options = {
    node: { kind: "elementCut" }, images: [{ path: "original-a.png" }, { path: "original-b.png" }],
    canceled: () => false, save: value => { record = structuredClone(value); },
    native: async (operation, value) => {
      assert.equal(operation, "detect-elements"); detects++; requestIds.push(value.requestId);
      return { elements: [{ id: "E001", name: "button", bbox: [4, 6, 18, 20] }] };
    },
    rpc: async (operation, value) => {
      calls.push(operation);
      if (operation === "pipeline-normalize") return { ...value.image };
      assert.equal(operation, "element-crop"); crops++;
      assert.equal(value.elements[0].bbox[0], 4);
      return [{ path: value.image.path + "-crop", state: "succeeded" }];
    }
  };
  const result = await pipeline.execute(options);
  assert.equal(result.length, 2);
  assert.equal(detects, 2); assert.equal(crops, 2);
  assert.notEqual(requestIds[0], requestIds[1]);
  await pipeline.execute({ ...options, previous: record });
  assert.equal(detects, 2); assert.equal(crops, 2);
  assert.ok(calls.every(call => ["pipeline-normalize", "element-crop"].includes(call)));
  assert.ok(pipeline.basic.includes("elementCut"));
});
test("failed recognition retains its request ID on retry", async () => {
  let previous, firstId;
  const options = {
    node: { kind: "elementCut" }, images: [{ path: "image.png" }], canceled: () => false,
    save: value => { previous = structuredClone(value); },
    rpc: async (_operation, value) => value.image,
    native: async (_operation, value) => { firstId = value.requestId; throw Error("unconfirmed"); }
  };
  await assert.rejects(pipeline.execute(options), /unconfirmed/);
  await assert.rejects(pipeline.execute({ ...options, previous, native: async (_operation, value) => {
    assert.equal(value.requestId, firstId); throw Error("still unconfirmed");
  } }), /still unconfirmed/);
});
