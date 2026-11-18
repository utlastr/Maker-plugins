const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function worker(native, busy = false) {
  const values = busy ? { "maker-console-origins": ["http://127.0.0.1:1234"] } : {};
  let reloads = 0;
  const event = () => ({ addListener() {} });
  const context = vm.createContext({
    importScripts() {}, fetch: async () => ({ ok: true, json: async () => ({ installId: "test", extensionId: "extension" }) }),
    URL, console,
    chrome: {
      runtime: { id: "extension", getManifest: () => ({ version: "4.5.4", key: "release" }),
        getURL: name => name, sendNativeMessage: (_name, request) => native(request), reload: () => reloads++,
        onInstalled: event(), onStartup: event(), onMessage: event() },
      storage: { local: { get: async () => values, set: async value => Object.assign(values, value) } },
      tabs: { query: async () => busy ? [{ id: 1, url: "http://127.0.0.1:1234/canvas" }] : [] },
      scripting: { executeScript: async () => [{ result: { saved: false, nativeBusy: true, customBusy: "true" } }] },
      alarms: { create: async () => {}, clear: async () => {}, onAlarm: event() }
    }
  });
  vm.runInContext(fs.readFileSync(require.resolve("../extension/install.js"), "utf8"), context);
  return { context, values, reloads: () => reloads };
}
test("concurrent refresh requests share one update check and wait for its final result", async () => {
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const instance = worker(async request => {
    if (request.action === "check") { calls++; await pending; }
    return { status: "current", version: "4.5.4", latestVersion: "4.5.4" };
  });
  const first = instance.context.checkUpdate(), second = instance.context.checkUpdate();
  assert.equal(first, second);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  release(); await first;
  assert.equal(instance.values["maker-update-status"].status, "current");
});
test("newer installed files reload only when canvas work is safe", async () => {
  for (const busy of [false, true]) {
    const instance = worker(async () => ({ status: "reload_required", version: "4.5.5" }), busy);
    await instance.context.checkUpdate();
    assert.equal(instance.reloads(), busy ? 0 : 1);
    assert.equal(instance.values["maker-update-status"].status, busy ? "waiting" : "installed");
  }
});
test("each Maker console, UI editor and canvas refresh triggers a check; other sites do not", () => {
  const code = fs.readFileSync(require.resolve("../extension/update-trigger.js"), "utf8");
  for (const [pathname, maker, expected] of [["/", true, 1], ["/canvas", false, 1],
    ["/ui-editor/", false, 1], ["/", false, 0]]) {
    let calls = 0;
    const context = vm.createContext({ location: { pathname },
      document: { getElementById: () => maker ? {} : null },
      chrome: { runtime: { sendMessage: async () => { calls++; } } } });
    vm.runInContext(code, context);
    vm.runInContext(code, context);
    assert.equal(calls, expected);
  }
});
