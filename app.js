// app.js — keypad overlay, viewport-sync, calibration + long-press 0 -> +
// Modified: invisible paste button, removed prompt fallback, typing delay = 1500ms,
// flash duration kept >= 300ms so your --press-fade-ms: 300ms is visible.

(() => {
  const displayEl = document.getElementById('display');
  const keysGrid = document.getElementById('keysGrid');
  const callBtn = document.getElementById('callBtn');
  const appEl = document.getElementById('app');
  const calUI = document.getElementById('calibrationUI');
  const calText = document.getElementById('calText');

  let digits = '';
  let longPressTimer = null;
  let longPressActive = false;
  const LONG_PRESS_MS = 300;
  const STORAGE_KEY = 'overlay-calibration-screenshot-v3';
  let calibration = { x: 0, y: 0 };

  const ORIGINAL_BG = "url('screenshot.png')";
  const FIRST_TYPED_BG = "url('numpad.png')";

  (function preloadReplacementImage() {
    try {
      const img = new Image();
      img.onload = () => console.log('numpad.png preloaded');
      img.onerror = () => console.warn('numpad.png preload failed');
      img.src = 'numpad.png';
    } catch (e) { console.warn('preload fail', e); }
  })();

  /* ---------- Viewport sync ---------- */
  (function setupViewportSync() {
    function updateViewportHeight() {
      try {
        const vv = window.visualViewport;
        const base = vv ? Math.round(vv.height) : window.innerHeight;
        const overfill = 8;
        const used = Math.max(100, base + overfill);
        document.documentElement.style.setProperty('--app-viewport-height', used + 'px');
        const ls = document.querySelector('.lockscreen');
        if (ls) ls.style.height = used + 'px';
        document.body.style.height = used + 'px';
      } catch (err) { console.warn('viewport sync failed', err); }
    }
    window.addEventListener('load', updateViewportHeight, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight, { passive: true });
      window.visualViewport.addEventListener('scroll', updateViewportHeight, { passive: true });
    }
    window.addEventListener('resize', updateViewportHeight, { passive: true });
    window.addEventListener('orientationchange', updateViewportHeight, { passive: true });
    updateViewportHeight();
    let t = 0;
    const id = setInterval(() => { updateViewportHeight(); t++; if (t > 20) clearInterval(id); }, 120);
  })();

  /* ---------- Calibration persistence ---------- */
  function loadCalibration() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        calibration = JSON.parse(raw);
        setCalibrationVars();
      }
    } catch (e) {}
  }
  function saveCalibration() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration)); } catch(e) {}
  }
  function setCalibrationVars() {
    document.documentElement.style.setProperty('--overlay-offset-x', (calibration.x || 0) + 'px');
    document.documentElement.style.setProperty('--overlay-offset-y', (calibration.y || 0) + 'px');
  }

  /* ---------- Standalone / PWA detection ---------- */
  function detectStandalone() {
    const isIOSStandalone = window.navigator.standalone === true;
    const isDisplayModeStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if (isIOSStandalone || isDisplayModeStandalone) {
      appEl.classList.add('standalone');
      document.documentElement.classList.add('is-pwa');
    } else {
      appEl.classList.remove('standalone');
      document.documentElement.classList.remove('is-pwa');
    }
  }
  detectStandalone();
  if (window.matchMedia) {
    try {
      const mq = window.matchMedia('(display-mode: standalone)');
      if (mq && mq.addEventListener) mq.addEventListener('change', detectStandalone);
      else if (mq && mq.addListener) mq.addListener(detectStandalone);
    } catch (e) {}
  }

  /* ---------- Display helpers ---------- */
  function updateDisplay() {
    if (!displayEl) return;
    if (digits.length === 0) {
      displayEl.style.opacity = '0';
      displayEl.textContent = '';
    } else {
      displayEl.style.opacity = '1';
      displayEl.textContent = digits;
    }
  }

  function onFirstCharTyped() {
    try { appEl.style.backgroundImage = FIRST_TYPED_BG; } catch(e) {}
  }

  function appendChar(ch) {
    if (digits.length >= 50) return;
    const wasEmpty = digits.length === 0;
    digits += ch;
    updateDisplay();
    if (wasEmpty) onFirstCharTyped();
  }
  function clearDigits() {
    digits = '';
    updateDisplay();
    try { appEl.style.backgroundImage = ORIGINAL_BG; } catch(e){}
  }
  function doVibrate() { if (navigator.vibrate) try { navigator.vibrate(8); } catch(e){} }

  /* ---------- SVG sanitization with bbox-based background removal ---------- */
  function sanitizeInjectedSVG(svg) {
    if (!svg) return;
    try {
      svg.querySelectorAll('metadata, desc, defs, title').forEach(el => el.remove());
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('focusable', 'false');
      svg.style.display = 'inline-block';

      let svgW = 0, svgH = 0;
      if (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width && svg.viewBox.baseVal.height) {
        svgW = svg.viewBox.baseVal.width;
        svgH = svg.viewBox.baseVal.height;
      } else {
        const vb = svg.getAttribute('viewBox');
        if (vb) {
          const parts = vb.trim().split(/\s+/).map(Number);
          if (parts.length === 4) { svgW = parts[2]; svgH = parts[3]; }
        }
      }

      if (!svgW || !svgH) {
        try {
          const sbb = svg.getBBox();
          svgW = sbb.width || svgW;
          svgH = sbb.height || svgH;
        } catch (e) {}
      }

      if (!svgW) svgW = 100;
      if (!svgH) svgH = 100;

      const shapeSelector = 'path, rect, circle, ellipse, polygon, polyline';
      const shapes = Array.from(svg.querySelectorAll(shapeSelector));
      const THRESHOLD = 0.9;
      shapes.forEach(el => {
        try {
          const bb = el.getBBox();
          const wRatio = (bb.width / svgW);
          const hRatio = (bb.height / svgH);
          if (wRatio >= THRESHOLD && hRatio >= THRESHOLD) {
            el.remove();
            return;
          }
        } catch (e) {}
      });

      svg.querySelectorAll('[id*="bg"], [class*="bg"], [id*="background"], [class*="background"]').forEach(el => el.remove());

      svg.querySelectorAll('*').forEach(el => {
        if (el.tagName.toLowerCase() === 'svg') return;
        try {
          el.setAttribute('fill', 'currentColor');
          el.setAttribute('stroke', 'none');
          el.style.vectorEffect = 'non-scaling-stroke';
        } catch (e) {}
      });

    } catch (err) {
      console.warn('sanitizeInjectedSVG failed', err);
    }
  }

  /* ---------- Template injection ---------- */
  function injectSVGFromTemplate(templateId, keySelector, spanClass) {
    try {
      const tpl = document.getElementById(templateId);
      const keyEl = keysGrid.querySelector(`.key[data-value="${keySelector}"]`);
      if (!tpl || !keyEl) return;
      const span = keyEl.querySelector('.digit');
      if (!span) return;

      if (!tpl.content || tpl.content.childElementCount === 0) {
        span.classList.add(spanClass || '');
        return;
      }

      const clone = tpl.content.cloneNode(true);
      span.textContent = '';
      span.appendChild(clone);
      span.classList.add(spanClass || '');

      const svg = span.querySelector('svg');
      sanitizeInjectedSVG(svg);

    } catch (err) {
      console.warn('injectSVGFromTemplate failed', err);
    }
  }

  /* ---------- Helper: briefly highlight a key visually ---------- */
  // FLASH_MS >= your --press-fade-ms (300ms) so fade is visible
  const FLASH_MS = 360;
  function flashKey(value, ms = FLASH_MS) {
    const keyEl = keysGrid.querySelector(`.key[data-value="${value}"]`);
    if (!keyEl) return;
    keyEl.classList.add('pressed');
    setTimeout(() => keyEl.classList.remove('pressed'), ms);
  }

  /* ---------- Keys setup & press behavior ---------- */
  function setupKeys() {
    if (!keysGrid) return;

    // Inject & sanitize inline svgs for '*' and '#' (keeps backward compatibility if template exists)
    injectSVGFromTemplate('svg-asterisk-template', '*', 'digit-asterisk');
    injectSVGFromTemplate('svg-hash-template', '#', 'digit-hash');

    keysGrid.querySelectorAll('.key').forEach(key => {
      const value = key.dataset.value;

      key.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        try { key.setPointerCapture(ev.pointerId); } catch(e){}
        key.style.transition = 'none';
        key.classList.add('pressed');
        void key.offsetHeight;
        key.style.transition = '';
        doVibrate();
        longPressActive = false;

        if (value === '0') {
          longPressTimer = setTimeout(() => {
            longPressActive = true;
            appendChar('+');
          }, LONG_PRESS_MS);
        }
      });

      key.addEventListener('pointerup', (ev) => {
        ev.preventDefault();
        try { key.releasePointerCapture(ev.pointerId); } catch(e){}
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        if (!longPressActive) {
          if (key.dataset.value !== 'paste') appendChar(value);
        }
        longPressActive = false;
        setTimeout(() => { key.classList.remove('pressed'); }, 10);
      });

      key.addEventListener('pointerleave', (ev) => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        key.classList.remove('pressed');
        longPressActive = false;
      });

      key.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { if (!ev.repeat) { ev.preventDefault(); key.classList.add('pressed'); } }
      });
      key.addEventListener('keyup', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          key.classList.remove('pressed');
          if (key.dataset.value === 'paste') {
            runClipboardTypeSequence();
          } else {
            appendChar(value);
          }
        }
      });
    });
  }

  /* ---------- Call button ---------- */
  if (callBtn) {
    callBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!digits || digits.length === 0) {
        callBtn.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 220 });
        return;
      }
      const sanitized = digits.replace(/[^\d+#*]/g, '');
      window.location.href = 'tel:' + sanitized;
    });
  }

  /* ---------- Clipboard play button: insertion + behavior ---------- */
  let typingInProgress = false;
  let typingAbort = false;

  // Set typing delay to 1500ms so your 300ms fade is visible between the typed characters
  const TYPING_DELAY_MS = 1500;

  async function runClipboardTypeSequence() {
    if (typingInProgress) {
      typingAbort = true;
      return;
    }

    let raw = '';
    try {
      raw = await navigator.clipboard.readText();
    } catch (err) {
      console.warn('Clipboard read failed or was denied; aborting automatic typing.', err);
      return;
    }

    raw = (raw || '').trim();
    if (!raw) {
      const pb = document.getElementById('pasteBtn');
      if (pb) {
        try { pb.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 200 }); } catch (e) {}
      }
      return;
    }

    // sanitize: allow digits and plus sign
    let toType = raw.replace(/[^\d+]/g, '');
    if (!toType) return;

    typingInProgress = true;
    typingAbort = false;

    const pasteBtn = document.getElementById('pasteBtn');
    if (pasteBtn) pasteBtn.classList.add('active');

    for (const ch of toType) {
      if (typingAbort) break;
      flashKey(ch, FLASH_MS);
      appendChar(ch);
      await new Promise(res => setTimeout(res, TYPING_DELAY_MS));
    }

    typingInProgress = false;
    typingAbort = false;
    if (pasteBtn) pasteBtn.classList.remove('active');
  }

  function insertInvisiblePasteButtonIntoHashSlot() {
    if (!keysGrid) return;
    const oldHash = keysGrid.querySelector('.key[data-value="#"]');

    const btn = document.createElement('button');
    btn.className = 'key';
    btn.setAttribute('aria-label', 'Paste from clipboard');
    btn.setAttribute('title', 'Paste & play');
    btn.dataset.value = 'paste';
    btn.id = 'pasteBtn';
    btn.innerHTML = '<span class="digit">▶</span><span class="letters"></span>';

    // invisible but interactive
    btn.style.background = 'transparent';
    btn.style.color = 'transparent';
    btn.style.border = 'none';
    btn.style.boxShadow = 'none';
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'auto';
    btn.style.outline = 'none';
    btn.setAttribute('aria-hidden', 'false');

    if (oldHash && oldHash.parentNode) {
      oldHash.parentNode.replaceChild(btn, oldHash);
    } else {
      keysGrid.appendChild(btn);
    }

    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      runClipboardTypeSequence();
    });

    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        btn.classList.add('pressed');
      }
    });
    btn.addEventListener('keyup', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        btn.classList.remove('pressed');
        runClipboardTypeSequence();
      }
    });
  }

  /* ---------- Keyboard events + calibration toggle ---------- */
  let calibrationMode = false;
  function enterCalibration() {
    calibrationMode = true;
    calUI.classList.add('show');
    calText.textContent = `Calibration: x=${calibration.x}px y=${calibration.y}px — arrow keys to nudge. Enter save, Esc cancel.`;
    calUI.setAttribute('aria-hidden', 'false');
  }
  function exitCalibration(save) {
    calibrationMode = false;
    calUI.classList.remove('show');
    calUI.setAttribute('aria-hidden', 'true');
    if (save) saveCalibration();
    else { loadCalibration(); setCalibrationVars(); }
  }
  function adjustCalibration(dir) {
    const step = 2;
    if (dir === 'up') calibration.y -= step;
    if (dir === 'down') calibration.y += step;
    if (dir === 'left') calibration.x -= step;
    if (dir === 'right') calibration.x += step;
    setCalibrationVars();
    calText.textContent = `Calibration: x=${calibration.x}px y=${calibration.y}px — arrow keys to nudge. Enter save, Esc cancel.`;
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'c' || ev.key === 'C') {
      if (!calibrationMode) enterCalibration(); else exitCalibration(true);
      return;
    }

    if (calibrationMode) {
      if (ev.key === 'ArrowUp') { ev.preventDefault(); adjustCalibration('up'); }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); adjustCalibration('down'); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); adjustCalibration('left'); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); adjustCalibration('right'); }
      if (ev.key === 'Enter') { ev.preventDefault(); saveCalibration(); exitCalibration(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); exitCalibration(false); }
      return;
    }

    if (ev.key >= '0' && ev.key <= '9') appendChar(ev.key);
    else if (ev.key === '+' || ev.key === '*' || ev.key === '#') appendChar(ev.key);
    else if (ev.key === 'Backspace') {
      digits = digits.slice(0, -1);
      updateDisplay();
      if (digits.length === 0) { try { appEl.style.backgroundImage = ORIGINAL_BG; } catch(e){} }
    }
  });

  // bottom nav taps (visual only)
  document.querySelectorAll('.bottom-nav .nav-item').forEach((el, idx) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      el.classList.add('pressed');
      setTimeout(()=>el.classList.remove('pressed'), 160);
    });
  });

  // init
  loadCalibration();
  detectStandalone();
  setupKeys();

  // Insert the invisible "paste/play" button into the hash slot (below 9)
  insertInvisiblePasteButtonIntoHashSlot();

  updateDisplay();

  document.addEventListener('click', () => { try { document.activeElement.blur(); } catch(e){} });

  // API
  window.__phoneKeypad = {
    append: (ch) => { appendChar(ch); },
    clear: clearDigits,
    getDigits: () => digits,
    isStandalone: () => appEl.classList.contains('standalone'),
    calibration: () => ({...calibration}),
    runClipboardTypeSequence: runClipboardTypeSequence,
    cancelTyping: () => { typingAbort = true; }
  };
})();
