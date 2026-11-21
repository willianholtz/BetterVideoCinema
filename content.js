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
  const PANEL_ID = 'bvc-controls';

  // Tamanho da "tela" do cinema. `auto` = aba inteira (padrão atual).
  const FRAME_SIZES = {
    auto:  { label: 'Ajustar', w: '100vw', h: '100vh', inset: '0' },
    '720': { label: '720p',    w: 'min(1280px, 100vw)', h: 'min(720px, 100vh)',  inset: null },
    '1080':{ label: '1080p',   w: 'min(1920px, 100vw)', h: 'min(1080px, 100vh)', inset: null },
    '2160':{ label: '4K',      w: 'min(3840px, 100vw)', h: 'min(2160px, 100vh)', inset: null },
  };

  let active = false;
  let overlay = null;
  let current = null;
  let candidates = [];
  let scrollBackup = null;
  let domObserver = null;
  let attrObserver = null;
  let qualityOptions = [];
  let qualityController = null;
  let frameSize = 'auto';
  let savedMuted = null;   // null = nunca configurado → não mexe no som do site
  let savedVolume = null;
  let audioListener = null;
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

  // ---------- resolução / qualidade ----------

  function labelFromText(text) {
    const s = String(text || '');
    let m = s.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240)\s*(?:p|\b)/i);
    if (m) return m[1] + 'p';
    if (/\b4k\b/i.test(s)) return '2160p';
    return null;
  }

  // Tenta achar um controlador adaptativo (HLS.js / player) que troque de
  // nível SEM recriar o elemento — caminho preferido, sem buffering longo.
  function findAdaptiveController() {
    const v = current;
    const seen = new Set();
    const candidates = [];
    const push = (o) => {
      if (o && typeof o === 'object' && !seen.has(o)) { seen.add(o); candidates.push(o); }
    };
    push(v && v.hls);
    push(v && v._hls);
    push(window.hls);
    push(window.player);
    push(v && v.player);
    push(v && v._player);

    for (const o of candidates) {
      try {
        let levels = o.levels || (typeof o.getLevels === 'function' && o.getLevels());
        if (!levels && o.playback) levels = o.playback.levels;
        if (!Array.isArray(levels) || !levels.length) continue;

        const readLevel = () => {
          for (const l of [o.currentLevel, o.level, o.currentQuality, o.playback && o.playback.currentLevel]) {
            if (typeof l === 'number' && l >= 0) return l;
          }
          return -1;
        };
        const writeLevel = (i) => {
          if ('currentLevel' in o) o.currentLevel = i;
          else if ('level' in o) o.level = i;
          else if ('currentQuality' in o) o.currentQuality = i;
          else if (typeof o.setLevel === 'function') o.setLevel(i);
          else if (typeof o.setQuality === 'function') o.setQuality(i);
          else if (o.playback && 'currentLevel' in o.playback) o.playback.currentLevel = i;
          else return false;
          return true;
        };
        return { levels, readLevel, writeLevel };
      } catch (e) { /* player esquisito, tenta o próximo */ }
    }
    return null;
  }

  // Descobre as qualidades que o SITE oferece. Nunca inventa resolução:
  // se o site só tem 720p, é só isso que aparece no menu.
  function detectQualities() {
    const v = current;
    if (!v) return [];
    const out = [];
    const seen = new Set();
    const add = (label, src, kind, index) => {
      if (!label) return;
      const key = label + '|' + (src || '') + '|' + (index == null ? '' : index);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ label, src, kind, index });
    };

    qualityController = findAdaptiveController();
    if (qualityController) {
      qualityController.levels.forEach((lv, i) => {
        const label = labelFromText(
          (lv && (lv.label || lv.name || lv.height || lv.width || lv.bitrate)) || ''
        ) || (lv && lv.height ? lv.height + 'p' : 'Nível ' + (i + 1));
        add(label, null, 'adaptive', i);
      });
    }

    // <source> filhos do vídeo e do container do player (padrão comum em KVS).
    const roots = [v, v.parentElement, v.parentElement && v.parentElement.parentElement];
    for (const root of roots) {
      if (!root || !root.querySelectorAll) continue;
      let sources;
      try { sources = root.querySelectorAll('source'); } catch (e) { continue; }
      sources.forEach((s) => {
        const src = s.getAttribute('src') || s.src || '';
        const label = labelFromText(
          s.dataset.res || s.dataset.quality || s.dataset.label ||
          s.getAttribute('res') || s.getAttribute('quality') ||
          s.getAttribute('label') || s.getAttribute('title') || src
        );
        add(label, src, 'source', null);
      });
    }

    // URL atual (quando o nome do arquivo traz a resolução).
    const now = v.currentSrc || v.src || '';
    const nowLabel = labelFromText(now);
    if (nowLabel) add(nowLabel + ' (atual)', now, 'current', null);

    // Ordena: maior resolução primeiro.
    out.sort((a, b) => (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0));
    return out;
  }

  // Troca de stream mantendo posição/estado — não "reinicia do zero".
  function switchToSource(src) {
    const v = current;
    if (!v || !src) return false;
    const state = {
      time: v.currentTime,
      paused: v.paused,
      volume: v.volume,
      muted: v.muted,
      rate: v.playbackRate,
    };
    const restore = () => {
      v.removeEventListener('loadedmetadata', restore);
      try { if (Number.isFinite(state.time) && state.time > 0) v.currentTime = state.time; } catch (e) {}
      try {
        v.volume = savedVolume != null ? savedVolume : state.volume;
        v.muted  = savedMuted  != null ? savedMuted  : state.muted;
        v.playbackRate = state.rate;
      } catch (e) {}
      if (!state.paused && typeof v.play === 'function') {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      refreshQualityMenu();
    };
    v.addEventListener('loadedmetadata', restore);
    try {
      v.src = src;
      if (typeof v.load === 'function') v.load();
    } catch (e) {
      v.removeEventListener('loadedmetadata', restore);
      return false;
    }
    return true;
  }

  // ---------- áudio persistente ----------

  function applySavedAudio(v) {
    if (!v) return;
    try {
      if (savedVolume != null) v.volume = savedVolume;
      if (savedMuted != null) v.muted = savedMuted;
    } catch (e) { /* vídeo sem áudio/controle */ }
  }

  function updateMuteButton() {
    const b = overlay && overlay.querySelector('#bvc-mute-btn');
    if (!b) return;
    const muted = current ? !!current.muted : !!savedMuted;
    b.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    b.title = muted ? 'Ativar som (preferência salva)' : 'Silenciar (fica mudo sempre)';
  }

  function saveAudioState(v) {
    if (!v) return;
    try {
      savedMuted = !!v.muted;
      savedVolume = v.volume;
      chrome.storage.local.set({ bvcMuted: savedMuted, bvcVolume: savedVolume });
    } catch (e) { /* storage indisponível */ }
    updateMuteButton();
  }

  function watchAudio(v) {
    if (audioListener && current) {
      try { current.removeEventListener('volumechange', audioListener); } catch (e) {}
    }
    audioListener = () => saveAudioState(v);
    try { v.addEventListener('volumechange', audioListener); } catch (e) {}
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
    const btnSettings = makeButton('\u2699', 'Resolução e enquadramento', () => togglePanel());
    btnSettings.style.right = '110px';
    btnSettings.id = 'bvc-settings-btn';
    const btnMute = makeButton('\u{1F50A}', 'Silenciar (fica mudo sempre)', () => {
      if (!current) return;
      try {
        current.muted = !current.muted;
        saveAudioState(current);
      } catch (e) {}
    });
    btnMute.style.right = '158px';
    btnMute.id = 'bvc-mute-btn';

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    setImp(panel, 'position', 'absolute');
    setImp(panel, 'top', '60px');
    setImp(panel, 'right', '14px');
    setImp(panel, 'width', '190px');
    setImp(panel, 'max-height', '70vh');
    setImp(panel, 'overflow-y', 'auto');
    setImp(panel, 'padding', '10px');
    setImp(panel, 'box-sizing', 'border-box');
    setImp(panel, 'background', 'rgba(8,8,8,0.92)');
    setImp(panel, 'border', '1px solid rgba(255,255,255,0.2)');
    setImp(panel, 'border-radius', '10px');
    setImp(panel, 'color', '#eee');
    setImp(panel, 'font', '12px/1.4 system-ui, sans-serif');
    setImp(panel, 'z-index', '5');
    setImp(panel, 'display', 'none');
    setImp(panel, 'text-align', 'left');

    o.appendChild(btnMute);
    o.appendChild(btnSettings);
    o.appendChild(btnSwitch);
    o.appendChild(btnClose);
    o.appendChild(panel);
    return o;
  }

  function panelOption(label, active, onClick, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (title) b.title = title;
    setImp(b, 'display', 'block');
    setImp(b, 'width', '100%');
    setImp(b, 'margin', '3px 0');
    setImp(b, 'padding', '6px 8px');
    setImp(b, 'border-radius', '6px');
    setImp(b, 'border', '1px solid ' + (active ? '#4c8bf5' : 'rgba(255,255,255,0.18)'));
    setImp(b, 'background', active ? 'rgba(76,139,245,0.28)' : 'rgba(255,255,255,0.06)');
    setImp(b, 'color', active ? '#fff' : '#ccc');
    setImp(b, 'font', 'inherit');
    setImp(b, 'text-align', 'left');
    setImp(b, 'cursor', 'pointer');
    b.addEventListener('mouseenter', () => setImp(b, 'background', 'rgba(255,255,255,0.18)'));
    b.addEventListener('mouseleave', () => setImp(b, 'background', active ? 'rgba(76,139,245,0.28)' : 'rgba(255,255,255,0.06)'));
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  function sectionTitle(text) {
    const d = document.createElement('div');
    d.textContent = text;
    setImp(d, 'margin', '4px 0 6px');
    setImp(d, 'font-size', '10px');
    setImp(d, 'letter-spacing', '1px');
    setImp(d, 'color', '#888');
    setImp(d, 'text-transform', 'uppercase');
    return d;
  }

  function togglePanel(force) {
    if (!overlay) return;
    const panel = overlay.querySelector('#' + PANEL_ID);
    if (!panel) return;
    const show = typeof force === 'boolean' ? force : (panel.style.display === 'none');
    setImp(panel, 'display', show ? 'block' : 'none');
    if (show) refreshQualityMenu();
  }

  function applyFrame(size) {
    if (!FRAME_SIZES[size]) return;
    frameSize = size;
    if (!overlay) return;
    const cfg = FRAME_SIZES[size];
    setImp(overlay, 'width', cfg.w);
    setImp(overlay, 'height', cfg.h);
    if (cfg.inset) {
      setImp(overlay, 'top', '0');
      setImp(overlay, 'left', '0');
      setImp(overlay, 'transform', 'none');
    } else {
      setImp(overlay, 'top', '50%');
      setImp(overlay, 'left', '50%');
      setImp(overlay, 'transform', 'translate(-50%, -50%)');
    }
    try { chrome.storage.local.set({ bvcFrame: size }); } catch (e) {}
    refreshQualityMenu();
  }

  function currentAdaptiveIndex() {
    return qualityController ? qualityController.readLevel() : -1;
  }

  function refreshQualityMenu() {
    if (!overlay) return;
    const panel = overlay.querySelector('#' + PANEL_ID);
    if (!panel || panel.style.display === 'none') return;
    panel.innerHTML = '';

    panel.appendChild(sectionTitle('Qualidade do stream'));
    qualityOptions = detectQualities();
    const activeIdx = currentAdaptiveIndex();

    if (!qualityOptions.length) {
      const note = document.createElement('div');
      note.textContent = 'Este site não expõe qualidades. Use o controle dele.';
      setImp(note, 'color', '#999');
      setImp(note, 'padding', '4px 0');
      panel.appendChild(note);
    } else {
      qualityOptions.forEach((opt) => {
        const active = (opt.kind === 'adaptive' && opt.index === activeIdx) ||
                       (opt.kind === 'current' && activeIdx < 0);
        panel.appendChild(panelOption(
          opt.label,
          active,
          () => {
            if (opt.kind === 'adaptive' && qualityController) {
              qualityController.writeLevel(opt.index);
            } else if (opt.src) {
              switchToSource(opt.src);
            }
            setTimeout(refreshQualityMenu, 300);
          },
          opt.kind === 'adaptive' ? 'Troca direta no player (sem recarregar)' : 'Troca o stream mantendo o tempo atual'
        ));
      });
    }

    panel.appendChild(sectionTitle('Enquadramento'));
    Object.keys(FRAME_SIZES).forEach((key) => {
      panel.appendChild(panelOption(FRAME_SIZES[key].label, key === frameSize, () => applyFrame(key)));
    });

    if (current) {
      const info = document.createElement('div');
      setImp(info, 'margin-top', '8px');
      setImp(info, 'font-size', '10px');
      setImp(info, 'color', '#777');
      info.textContent = 'Original: ' + current.videoWidth + '×' + current.videoHeight;
      panel.appendChild(info);
    }
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
    applySavedAudio(v);
    watchAudio(v);
    updateMuteButton();
    applyFrame(frameSize);
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
    if (audioListener && current) {
      try { current.removeEventListener('volumechange', audioListener); } catch (e) {}
    }
    audioListener = null;

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

  const onMessage = (msg, _sender, sendResponse) => {
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
  };
  try {
    if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(onMessage);
  } catch (e) { /* browser sem extensão */ }

  // Preferências salvas entre sessões (enquadramento + áudio).
  try {
    chrome.storage.local.get(['bvcFrame', 'bvcMuted', 'bvcVolume'], (r) => {
      if (!r) return;
      if (r.bvcFrame && FRAME_SIZES[r.bvcFrame]) {
        frameSize = r.bvcFrame;
        if (overlay) applyFrame(frameSize);
      }
      if (typeof r.bvcMuted === 'boolean') savedMuted = r.bvcMuted;
      if (typeof r.bvcVolume === 'number') savedVolume = r.bvcVolume;
      if (current) applySavedAudio(current);
      updateMuteButton();
    });
  } catch (e) { /* storage indisponível */ }

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
