# 🎬 Better Video Cinema

> **Turn any webpage video into a distraction-free cinema — without reloading it.**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4c8bf5?style=flat-square)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Browsers](https://img.shields.io/badge/Browsers-Vivaldi%20%7C%20Chrome%20%7C%20Edge-32373c?style=flat-square)](https://vivaldi.com/)
[![Version](https://img.shields.io/badge/version-1.3.0-2ea44f?style=flat-square)](https://github.com/willianholtz/BetterVideoCinema/releases)
[![Privacy](https://img.shields.io/badge/Tracking-none-2ea44f?style=flat-square)](https://github.com/willianholtz/BetterVideoCinema)

---

## The problem

You open a video on a site that **doesn't have a cinema mode**. The player is
stuck in a narrow column, the page scrolls, ads and sidebars scream for your
attention, and the only "fullscreen" the site offers either crops the video or
throws you into a true fullscreen you can't easily escape.

Worse on **KVS Player V6** and similar adult/streaming CMS players: the real
`<video>` is buried inside iframes or shadow DOM, there are several videos per
page, and the site actively re-adds its own `controls` attribute.

## The solution

One click on the toolbar button and the **actual `<video>` element** is lifted
out of the page into a pure-black, full-viewport overlay — centered, letterboxed,
with controls forced on. The page behind it stops scrolling. Press `Esc`, click
`✕`, or click the button again and **the video goes back exactly where it came
from**, with its original position, inline styles, and controls restored.

💡 The element is **moved, not recreated**. No `src` change, no reload, no new
request. That means it keeps working with **MSE, `blob:` URLs, live streams and
DRM-protected playback** — things a naive "clone the video" approach breaks.

---

## ✨ Features

| | What you get |
|---|---|
| 🖤 **True cinema** | Pure-black full-tab overlay; video centered with `object-fit: contain` (no cropping, no stretching). |
| 🔁 **Same element** | The live `<video>` is moved, never reloaded — playback continues uninterrupted. |
| 🧩 **Works in iframes** | The background worker probes **every frame** and activates in the one holding the biggest video. |
| 🌑 **Shadow DOM aware** | Walks `shadowRoot` trees to find players that hide their `<video>` from `querySelector`. |
| ⏳ **Lazy-load tolerant** | If the video isn't there yet, retries after 1.5 s instead of giving up. |
| 🔀 **Swap videos** | `⇄` cycles through all videos on the page — handy on KVS pages with several clips. |
| 🎚️ **Quality control** | `⚙` opens a menu with the qualities the **site actually offers** (720p, 1080p, 4K…). Adaptive players switch levels **in place**; plain streams switch `src` while keeping the current time. |
| 🖥️ **Frame size** | Pick **720p / 1080p / 4K / Fit** for the cinema screen itself. The choice is remembered between sessions. |
| 🔇 **Sticky mute/volume** | Mute once and it stays muted — across videos, sites, and browser sessions. The `🔇/🔊` button and the player's own controls both update the saved preference. |
| ⏩ **Speed & fit** | `0.5x–2x` playback speed and **Contorno / Preencher** (contain/cover) in the ⚙ panel — both remembered. |
| 🖼️ **PiP + Fullscreen** | `⧉` sends the video to Picture-in-Picture; `⛶` enters real fullscreen (hides the browser chrome). |
| ✨ **Auto-hide controls** | Buttons fade to 12% after ~2 s and reappear on mouse movement — pure immersion. |
| 🧹 **Perfect restore** | Original parent, sibling position, `style` and `controls` attributes are backed up and put back. |
| 🎛️ **Bottom toolbar** | Buttons sit in a slim bar **below the player**, never over the picture. |
| ✨ **Auto-hide controls** | Buttons reappear fast (0.15 s) on mouse move and fade out slowly (0.8 s) after ~3 s. |
| ⌨️ **Keyboard + Ctrl+Shift+Y** | Seeking, volume, mute, next video, fullscreen and a global shortcut to toggle cinema mode. |
| 🟢 **Clear state** | An **ON** badge on the toolbar button while cinema mode is active in that tab. |
| 🛡️ **Private** | No analytics, no network calls, no data collection. Local browser code only. |

---

## 🎯 Tested on

- **KVS Player V6** ✅ (the real-world case that motivated the project)
- Plain `<video>` tags and YouTube-style players
- Players using `blob:` / Media Source Extensions
- Multi-video pages and iframe-embedded players
- 16:9 and 4:3 content (letterboxed correctly)

---

## 📦 Install (unpacked / developer mode)

Works in **Vivaldi**, **Google Chrome**, **Microsoft Edge**, and any other
Chromium browser with Manifest V3 support.

1. Download or clone this repo:

   ```bash
   git clone https://github.com/willianholtz/BetterVideoCinema.git
   ```

2. Open the extensions page:
   - Vivaldi → `vivaldi://extensions`
   - Chrome/Edge → `chrome://extensions` / `edge://extensions`

3. Turn on **Developer mode** (top-right toggle).

4. Click **Load unpacked** and select the repository folder.

5. (Optional) Pin the extension to the toolbar so the button is always visible:
   right-click the toolbar → **Customize toolbar** → pin **Better Video Cinema**.

That's it — no build step, no dependencies, no server.

---

## 🚀 Usage

1. Open any page with a video.
2. Click the **Better Video Cinema** toolbar button — one click is all it takes.
3. Enjoy the black void.
4. Exit with `Esc`, the `✕` button, or by clicking the toolbar button again.

### On-screen controls

All buttons live in a slim bar **below the video** (`#bvc-toolbar`), so the
picture is never covered.

| Button | Action |
|---|---|
| `✕` | Leave cinema mode and restore the video. |
| `⇄` | Switch to the next video on the page. |
| `⚙` | Open the **Resolution / Framing / Speed / Fit** panel. |
| `🔇` / `🔊` | Toggle mute. The choice is saved globally, so it applies to the next video too. |
| `⛶` | Enter/exit real fullscreen (`F`). |
| `⧉` | Enter/exit Picture-in-Picture. |

The controls appear fast (0.15 s) when you move the mouse and fade out slowly
(0.8 s) after ~3 s of inactivity — just move the mouse to bring them back.

### ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl` + `Shift` + `Y` | Toggle cinema mode in the active tab (**global**, works without clicking). |
| `←` / `→` | Seek back / forward 5 seconds. |
| `↑` / `↓` | Volume up / down 10% (also saved). |
| `M` | Toggle mute (also saved). |
| `N` | Next video on the page. |
| `F` | Toggle fullscreen. |
| `Esc` | Leave cinema mode. |

### 🎚️ Resolution panel

The `⚙` panel has four sections:

- **Quality of stream** — auto-detected from adaptive player levels (HLS.js and
  similar), `<source>` tags (`data-res`, `res`, `quality`, filename patterns), or
  the current URL. Clicking a quality:
  - on an **adaptive player**, sets the level directly — no reload;
  - on a **plain stream**, swaps `src` and restores `currentTime`, volume, mute,
    playback rate and play state — a short buffer, but never back to 0:00.
  - if the site exposes no qualities, the panel says so instead of showing fake
    options. The addon **never invents resolution**: if the source is 480p, that's
    all you get. The real `videoWidth × videoHeight` is shown at the bottom.
- **Framing** — `Fit` (full tab, default), **720p**, **1080p**, **4K**. These set
  the size of the black cinema screen (capped at your actual viewport), so you
  can downsize the window even if your monitor is smaller than 4K.
- **Speed** — `0.5x / 0.75x / 1x / 1.25x / 1.5x / 2x`, applied to the live video
  without reloading and remembered for next time.
- **Image fit** — **Contorno** (`contain`, default — full image with black bars)
  or **Preencher** (`cover` — fills the screen, crops the edges). Handy for 4:3
  clips on a 16:9 display.

### 🔇 Sticky audio

Mute is a **global, persistent preference**. Use the `🔇/🔊` button in the
overlay or the player's native controls — either one writes `muted` and `volume`
to `chrome.storage.local`. When a video enters cinema mode (including after
`⇄`, a quality swap, or a browser restart), the saved values are applied to it.

If you never touched the volume, the addon leaves the site's own audio alone.

---

## ⚙️ How it works

```
Toolbar click
     │
     ▼
background.js (MV3 service worker)
     │  chrome.webNavigation.getAllFrames(tabId)
     ▼
probe every frame → pick the frame with the largest <video>
     │
     ▼
content.js (injected in all frames)
     │  collectVideos() — walks document + shadow roots, sorts by area
     ▼
backup parent / nextSibling / style / controls
     │
     ▼
move the <video> into a fixed black overlay (z-index max)
     │
     ▼
force controls · lock scroll · badge ON · watch for DOM tampering
     │
     ▼
apply saved audio · speed · fit · frame size
     │
     ▼
⚙ menu: quality · framing · speed · image fit     ⛶ fullscreen     ⧉ PiP
     │
     ▼
keyboard: ← → seek · ↑ ↓ volume · M mute · N next · F fullscreen · Esc exit
```

The content script also installs a `MutationObserver` that re-adds `controls`
if the site strips it, and another that exits cinema mode if the page removes
the overlay. State is kept per tab, so switching tabs and coming back keeps the
same mode. Audio, speed, image fit and frame size are saved in
`chrome.storage.local` and restored on the next activation.

The `Ctrl+Shift+Y` command is declared in `manifest.json` and handled by the service
worker through the same `toggleInTab()` used by the toolbar button, so the
frame-selection logic is identical.

---

## 🔐 Privacy & permissions

| Permission | Why |
|---|---|
| `<all_urls>` host access | Needed to reach the video on **any** site — including pages with iframes. |
| `scripting` | Injects `content.js` into a frame if it wasn't loaded automatically. |
| `webNavigation` | Lists the tab's frames to find the one with the biggest video. |
| `storage` | Remembers frame size, mute/volume, speed and image fit. |
| `commands` (Ctrl+Shift+Y) | Global shortcut declared in the manifest; no extra runtime permission. |

There are **no external requests**. The extension only injects local code and
moves DOM nodes inside the current tab.

---

## 📁 Project structure

```
BetterVideoCinema/
├── manifest.json     # MV3 definition, version 1.3.0, Ctrl+Shift+Y command
├── background.js     # toolbar action + shortcut, frame probing, ON badge
├── content.js        # video discovery, overlay, controls, shortcuts, restore
├── teste.html        # local test page (16:9 + 4:3 samples)
├── sample-16x9.mp4   # test fixture
└── sample-4x3.mp4    # test fixture
```

## 🧪 Quick local test

Open `teste.html` directly in the browser, click the toolbar button, then try
`Esc`, `⇄`, and click again. Both aspect ratios should fit without cropping.

To check the controls: click `⚙`, switch between **720p / 1080p / 4K / Fit**,
try **0.5x–2x** and **Contorno/Preencher**, then press `← → ↑ ↓ M N F`. Move the
mouse to bring the faded buttons back. Mute and volume survive a page reload.
The test page has plain streams; on a page with multiple `<source>` tags or an
adaptive player the **Quality** section fills up automatically. Test `Ctrl+Shift+Y` in
the real browser — the headless test harness cannot verify browser-level
shortcuts or native fullscreen/PiP.

---

## 📄 License

Free to use, modify and share. Built to fix a real annoyance on real sites.
