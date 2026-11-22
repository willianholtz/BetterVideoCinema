// Modo Cinema — service worker (MV3)
// Botão da toolbar: detecta em qual frame está o maior vídeo e alterna o modo lá.

async function toggleInTab(tab) {
  const tabId = tab && tab.id;
  if (tabId == null) return;

  // 1. Lista todos os frames da aba (top + iframes).
  let frames = [{ frameId: 0 }];
  try {
    const got = await chrome.webNavigation.getAllFrames({ tabId });
    if (Array.isArray(got) && got.length) frames = got;
  } catch (e) { /* sem permissão → só top frame */ }

  // 2. Pergunta a cada frame se tem vídeo e qual a área do maior.
  const probes = await Promise.all(frames.map(async (f) => {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { cmd: 'probe' }, { frameId: f.frameId });
      return { frameId: f.frameId, area: (r && typeof r.area === 'number') ? r.area : 0 };
    } catch (e) {
      return { frameId: f.frameId, area: 0 };
    }
  }));

  const best = probes.reduce((a, b) => (b.area > a.area ? b : a), probes[0]);
  if (!best || best.area <= 0) {
    setBadge(tabId, '!', '#c0392b');
    setTimeout(() => setBadge(tabId, ''), 1600);
    return;
  }

  // 3. Alterna no frame com o maior vídeo.
  try {
    const res = await chrome.tabs.sendMessage(tabId, { cmd: 'toggle' }, { frameId: best.frameId });
    if (res && res.ok === false && res.reason === 'no-video') {
      // lazy load: tenta de novo após 1.5s
      setTimeout(async () => {
        try {
          const r2 = await chrome.tabs.sendMessage(tabId, { cmd: 'toggle' }, { frameId: best.frameId });
          setBadge(tabId, r2 && r2.active ? 'ON' : (r2 && r2.ok === false ? '!' : ''));
          if (r2 && r2.ok === false) setTimeout(() => setBadge(tabId, ''), 1600);
        } catch (e) { /* silencioso */ }
      }, 1500);
      setBadge(tabId, '…', '#555');
      return;
    }
    if (res && res.ok === false) {
      setBadge(tabId, '!', '#c0392b');
      setTimeout(() => setBadge(tabId, ''), 1600);
      return;
    }
    setBadge(tabId, res && res.active ? 'ON' : '');
  } catch (e) {
    // Content script ausente → injeta no top frame e tenta de novo.
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });
      const res = await chrome.tabs.sendMessage(tabId, { cmd: 'toggle' }, { frameId: best.frameId });
      setBadge(tabId, res && res.active ? 'ON' : '');
    } catch (e2) {
      setBadge(tabId, '!', '#c0392b');
      setTimeout(() => setBadge(tabId, ''), 1600);
    }
  }
}

function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  if (text && color) chrome.action.setBadgeBackgroundColor({ tabId, color });
}

chrome.action.onClicked.addListener(toggleInTab);

// Atalho global (Ctrl+Shift+Y) — usa a mesma lógica do botão da toolbar.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (cmd) => {
    if (cmd !== 'toggle-cinema') return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await toggleInTab(tab);
    } catch (e) { /* aba sem permissão */ }
  });
}

// O content script avisa quando o estado muda (sair pelo ✕ ou Esc).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'cinema-state' && sender.tab && sender.tab.id != null) {
    setBadge(sender.tab.id, msg.active ? 'ON' : '');
    if (msg.active) setBadge(sender.tab.id, 'ON', '#000000');
  }
});
