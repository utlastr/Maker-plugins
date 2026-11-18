'use strict';
(() => {
  const retiredGroups = new Set(['TapTap 制造', 'Maker 控制台', '本地游戏']);
  let timer;
  let running = false;
  let pending = false;

  function category(tab, consoleOrigins) {
    let url;
    try { url = new URL(tab.pendingUrl || tab.url); } catch { return -1; }
    if (url.hostname === 'maker.taptap.cn') return 0;
    if (url.hostname === 'local-game-hall.pages.dev') return 2;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return -1;
    if (['8811', '18811'].includes(url.port)) return 2;
    if (consoleOrigins.has(url.origin) || /Maker.*(?:控制台|Console)/i.test(tab.title || '') ||
        url.pathname === '/canvas' || url.searchParams.has('projectid')) return 1;
    return -1;
  }

  async function organize() {
    if (running) { pending = true; return; }
    running = true;
    try {
      const stored = await chrome.storage.local.get('maker-console-origins');
      const consoleOrigins = new Set(stored['maker-console-origins'] || []);
      const groups = await chrome.tabGroups.query({});
      const oldGroupIds = new Set(groups.filter(g => retiredGroups.has(g.title)).map(g => g.id));
      const oldMembers = (await chrome.tabs.query({})).filter(tab => oldGroupIds.has(tab.groupId));
      if (oldMembers.length) await chrome.tabs.ungroup(oldMembers.map(tab => tab.id));
      const tabs = await chrome.tabs.query({});
      const background = new Set(groups.filter(g => g.title === 'Agent 后台').map(g => g.id));
      const windows = new Set(tabs.map(tab => tab.windowId));
      for (const windowId of windows) {
        const windowTabs = tabs.filter(tab => tab.windowId === windowId);
        const targets = windowTabs.filter(tab => !tab.pinned &&
          !background.has(tab.groupId) && tab.groupId === -1 && category(tab, consoleOrigins) >= 0)
          .sort((a, b) => category(a, consoleOrigins) - category(b, consoleOrigins) || a.index - b.index);
        let position = windowTabs.filter(tab => tab.pinned).length;
        for (const tab of targets) {
          const current = await chrome.tabs.get(tab.id);
          if (current.index !== position) await chrome.tabs.move(tab.id, { index: position });
          position++;
        }
      }
      await chrome.storage.local.set({ 'maker-tab-organizer-status': { ok: true, updatedAt: Date.now() } });
    } catch (error) {
      console.error('[Maker tab organizer]', error);
      await chrome.storage.local.set({
        'maker-tab-organizer-status': { ok: false, error: error.message, updatedAt: Date.now() },
      });
    } finally {
      running = false;
      if (pending) { pending = false; schedule(); }
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(organize, 250);
  }
  chrome.tabs.onCreated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if (change.url || change.title || change.status === 'complete' || change.pinned !== undefined) schedule();
  });
  chrome.tabs.onMoved.addListener(schedule);
  chrome.tabs.onAttached.addListener(schedule);
  chrome.tabs.onRemoved.addListener(schedule);
  chrome.tabGroups.onMoved.addListener(schedule);
  chrome.tabGroups.onUpdated.addListener(schedule);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['maker-console-origins']) schedule();
  });
  chrome.runtime.onStartup.addListener(schedule);
  chrome.runtime.onInstalled.addListener(schedule);
  globalThis.makerOrganizeTabs = organize;
  schedule();
})();
