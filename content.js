// Modo Cinema — content script
// Pega o <video> da página, move pra um overlay escuro em tela cheia (dentro da aba)
// e devolve pro lugar original ao desligar. Não recarrega o vídeo (mesmo elemento).
// Suporta shadow DOM (percorre shadow roots) e lazy-load (retry).

(() => {
  'use strict';

  if (window.__modoCinema) {
    window.__modoCinema.ping();
    return;
  }

  const OVERLAY_ID = 'modo-cinema-overlay';

  let active = false;
  let overlay = null;
  let current = null;
  let candidates = [];
  let scrollBackup = null;
  let domObserver = null;
  let attrObserver = null;
  const backups = new Map();

  // ---------- utilitários ----------

  function videoArea(v) {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  }

  // Percorre shadow roots também (players que escondem o <video> em shadow DOM).
  function collectVideos() {
    const out = [];
    const seen = new Set();
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return;
      try {
        root.querySelectorAll('video').forEach((v) => {
          if (!seen.has(v) && videoArea(v) > 100) {
            seen.add(v);
            out.push(v);
          }
        });
      } catch (e) { /* ignore */ }
      try {
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch (e) { /* ignore */ }
    };
    walk(document);
    return out.sort((a, b) => videoArea(b) - videoArea(a));
  }

  function notify() {
    try {
      const p = chrome.runtime.sendMessage({ type: 'cinema-state', active });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* extensão descartada */ }
  }

  const setImp = (el, prop, val) => el.style.setProperty(prop, val, 'important');

  // ---------- backup / restauração ----------

  function backup(v) {
    if (backups.has(v)) return;
    backups.set(v, {
      parent: v.parentNode,
      next: v.nextSibling,
      style: v.getAttribute('style'),
      controls: v.getAttribute('controls'),
    });
  }

  function restore(v) {
    const b = backups.get(v);
    if (!b) return;
    backups.delete(v);

    if (b.parent && b.parent.isConnected) {
      try {
        const next = b.next && b.next.parentNode === b.parent ? b.next : null;
        if (v.parentNode !== b.parent || v.nextSibling !== next) {
          b.parent.insertBefore(v, next);
        }
      } catch (e) { /* pai saiu do documento */ }
    }

    if (b.style == null) v.removeAttribute('style');
    else v.setAttribute('style', b.style);

    if (b.controls == null) v.removeAttribute('controls');
    else v.setAttribute('controls', b.controls);
  }

  // ---------- rolagem ----------

  function lockScroll() {
    scrollBackup = {
      html: document.documentElement.style.overflow,
      body: document.body ? document.body.style.overflow : null,
    };
    document.documentElement.style.overflow = 'hidden';
    if (document.body) document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    if (!scrollBackup) return;
    document.documentElement.style.overflow = scrollBackup.html;
    if (document.body && scrollBackup.body != null) {
      document.body.style.overflow = scrollBackup.body;
    }
    scrollBackup = null;
  }

  // ---------- overlay ----------

  function makeButton(glyph, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    b.setAttribute('aria-label', title);
    setImp(b, 'position', 'absolute');
    setImp(b, 'top', '14px');
    setImp(b, 'width', '38px');
    setImp(b, 'height', '38px');
    setImp(b, 'border-radius', '50%');
    setImp(b, 'border', '1px solid rgba(255,255,255,0.25)');
    setImp(b, 'background', 'rgba(0,0,0,0.55)');
    setImp(b, 'color', '#fff');
    setImp(b, 'font-size', '17px');
    setImp(b, 'line-height', '1');
    setImp(b, 'cursor', 'pointer');
    setImp(b, 'opacity', '0.45');
    setImp(b, 'z-index', '3');
    setImp(b, 'padding', '0');
    setImp(b, 'transition', 'opacity 0.15s');
    b.addEventListener('mouseenter', () => setImp(b, 'opacity', '1'));
    b.addEventListener('mouseleave', () => setImp(b, 'opacity', '0.45'));
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function createOverlay() {
    const o = document.createElement('div');
    o.id = OVERLAY_ID;
    setImp(o, 'position', 'fixed');
    setImp(o, 'top', '0');
    setImp(o, 'left', '0');
    setImp(o, 'width', '100vw');
    setImp(o, 'height', '100vh');
    setImp(o, 'background', '#000');
    setImp(o, 'z-index', '2147483647');
    setImp(o, 'display', 'flex');
    setImp(o, 'align-items', 'center');
    setImp(o, 'justify-content', 'center');
    setImp(o, 'margin', '0');
    setImp(o, 'padding', '0');
    setImp(o, 'border', 'none');
    setImp(o, 'pointer-events', 'auto');

    const btnClose = makeButton('\u2715', 'Sair do modo cinema (Esc)', () => deactivate());
    btnClose.style.right = '14px';
    const btnSwitch = makeButton('\u21C4', 'Trocar de vídeo', () => switchVideo());
    btnSwitch.style.right = '62px';
    o.appendChild(btnSwitch);
    o.appendChild(btnClose);
    return o;
  }

  function placeInCinema(v) {
    backup(v);
    overlay.insertBefore(v, overlay.firstChild);

    setImp(v, 'position', 'static');
    setImp(v, 'width', 'auto');
    setImp(v, 'height', 'auto');
    setImp(v, 'max-width', '100%');
    setImp(v, 'max-height', '100%');
    setImp(v, 'object-fit', 'contain');
    setImp(v, 'margin', '0');
    setImp(v, 'padding', '0');
    setImp(v, 'border', 'none');
    setImp(v, 'display', 'block');
    setImp(v, 'background', '#000');
    setImp(v, 'transform', 'none');
    setImp(v, 'filter', 'none');
    setImp(v, 'opacity', '1');
    setImp(v, 'visibility', 'visible');
    setImp(v, 'float', 'none');
    v.setAttribute('controls', '');

    current = v;
    restartAttrObserver();
  }

  // ---------- observadores ----------

  function startDomObserver() {
    if (domObserver) domObserver.disconnect();
    domObserver = new MutationObserver(() => {
      if (!active) return;
      if (!overlay || !overlay.isConnected || (current && !overlay.contains(current))) {
        deactivate();
      }
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function restartAttrObserver() {
    if (attrObserver) attrObserver.disconnect();
    if (!current) return;
    attrObserver = new MutationObserver(() => {
      if (!active || !current) return;
      if (!current.hasAttribute('controls')) current.setAttribute('controls', '');
    });
    attrObserver.observe(current, { attributes: true, attributeFilter: ['controls'] });
  }

  // ---------- ações ----------

  function activate() {
    if (active) return { ok: true, active: true };
    candidates = collectVideos();
    if (!candidates.length) return { ok: false, reason: 'no-video' };

    overlay = createOverlay();
    document.documentElement.appendChild(overlay);
    placeInCinema(candidates[0]);
    lockScroll();

    active = true;
    startDomObserver();
    notify();
    return { ok: true, active: true, count: candidates.length };
  }

  // activate com retry (lazy-load de vídeo).
  function activateWithRetry(cb) {
    let r = activate();
    if (r.ok) { cb(r); return; }
    setTimeout(() => {
      const r2 = activate();
      cb(r2);
    }, 1500);
  }

  function deactivate() {
    if (!active) return { ok: false };
    active = false;

    if (domObserver) { domObserver.disconnect(); domObserver = null; }
    if (attrObserver) { attrObserver.disconnect(); attrObserver = null; }

    for (const v of Array.from(backups.keys())) restore(v);

    if (overlay) { overlay.remove(); overlay = null; }
    current = null;
    unlockScroll();
    notify();
    return { ok: true, active: false };
  }

  function switchVideo() {
    if (!active) return { ok: false };

    const list = collectVideos();
    if (list.length < 2) return { ok: false, reason: 'one-video' };

    let idx = list.indexOf(current);
    let nextIdx = idx >= 0 ? (idx + 1) % list.length : 0;
    if (list[nextIdx] === current) nextIdx = (nextIdx + 1) % list.length;
    const next = list[nextIdx];
    if (!next || next === current) return { ok: false, reason: 'one-video' };

    const prev = current;
    restore(prev);
    if (overlay && overlay.contains(prev)) overlay.removeChild(prev);
    placeInCinema(next);
    return { ok: true, switched: true };
  }

  // ---------- teclado ----------

  window.addEventListener(
    'keydown',
    (e) => {
      if (active && e.key === 'Escape') deactivate();
    },
    true
  );

  // ---------- mensagens do background ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.cmd) return false;
    try {
      if (msg.cmd === 'probe') {
        const vs = collectVideos();
        sendResponse({ area: vs.length ? videoArea(vs[0]) : 0 });
        return false;
      }
      if (msg.cmd === 'toggle') {
        if (active) {
          sendResponse(deactivate());
          return false;
        }
        // tenta ativar; se não achou vídeo, retry lazy
        let r = activate();
        if (!r.ok && r.reason === 'no-video') {
          activateWithRetry((r2) => {
            // se ativou, avisa o background via state; responde agora
            sendResponse(r2);
          });
          return true; // canal aberto (async)
        }
        sendResponse(r);
        return false;
      }
      if (msg.cmd === 'switch') {
        sendResponse(switchVideo());
        return false;
      }
      sendResponse({ ok: false, reason: 'unknown-cmd' });
      return false;
    } catch (e) {
      sendResponse({ ok: false, reason: String(e && e.message || e) });
      return false;
    }
  });

  window.__modoCinema = {
    ping() {},
    toggle: () => (active ? deactivate() : activate()),
    next: () => switchVideo(),
    off: () => deactivate(),
    videos: () => collectVideos().map((v) => ({
      area: Math.round(videoArea(v)),
      src: (v.currentSrc || v.src || '(none)').slice(0, 80),
    })),
    isActive: () => active,
  };
})();
