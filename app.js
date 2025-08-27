// app.js — updated fetch + vibration diagnostics
(() => {
  const API_URL = 'https://shahulbreaker.in/api/getdata.php?user=Tarun';
  const FETCH_TIMEOUT_MS = 8000;

  const displayEl = document.getElementById('display');
  const keysGrid = document.getElementById('keysGrid');
  const callBtn = document.getElementById('callBtn');
  const appEl = document.getElementById('app');

  // debug strip (visible) so you can see what's returned — remove or hide later
  const debugStrip = document.createElement('div');
  debugStrip.id = 'apiDebugStrip';
  debugStrip.style.position = 'fixed';
  debugStrip.style.left = '8px';
  debugStrip.style.right = '8px';
  debugStrip.style.top = '8px';
  debugStrip.style.zIndex = '9999';
  debugStrip.style.background = 'rgba(0,0,0,0.6)';
  debugStrip.style.color = '#fff';
  debugStrip.style.fontSize = '12px';
  debugStrip.style.padding = '8px 10px';
  debugStrip.style.borderRadius = '8px';
  debugStrip.style.boxShadow = '0 6px 18px rgba(0,0,0,0.45)';
  debugStrip.style.pointerEvents = 'none';
  debugStrip.innerText = 'API: idle';
  document.body.appendChild(debugStrip);

  // small helper to update debug strip
  function setDebug(text) {
    debugStrip.innerText = text;
    console.debug('[app debug]', text);
  }

  // vibration helper — returns true if invoked (not guarantee device vibrated)
  function doVibrate(pattern = 20) {
    try {
      if ('vibrate' in navigator) {
        // Some browsers require a user gesture; call from pointerdown for reliability
        navigator.vibrate(pattern);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // timeout-fetch wrapper
  function timeoutFetch(url, opts = {}, timeout = FETCH_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('fetch-timeout'));
      }, timeout);

      fetch(url, Object.assign({ cache: 'no-store', mode: 'cors' }, opts)).then(res => {
        clearTimeout(timer);
        resolve(res);
      }).catch(err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // attempt to parse raw response text into a sensible value string
  function extractValueFromText(raw) {
    if (!raw) return null;
    const s = String(raw).trim();

    // 1) Try JSON parse and common keys
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === 'object') {
        if ('data' in parsed && parsed.data != null) return String(parsed.data).trim();
        if ('value' in parsed && parsed.value != null) return String(parsed.value).trim();
        if ('Value' in parsed && parsed.Value != null) return String(parsed.Value).trim();
        // fallback: first property that is string/number
        const keys = Object.keys(parsed);
        for (const k of keys) {
          const v = parsed[k];
          if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
        }
      }
    } catch (e) {
      // not JSON — continue
    }

    // 2) If server printed "Value: 12345" or "data=12345", try regex
    const kvMatch = s.match(/(?:Value|value|data)\s*[:=]\s*["']?([+\d\-\s\(\)]+?)["']?\s*(?:$|\r|\n)/i);
    if (kvMatch && kvMatch[1]) return kvMatch[1].trim();

    // 3) If plain text contains digits and plus, extract them
    const digitsOnly = s.match(/[+\d]{3,}/);
    if (digitsOnly) return digitsOnly[0];

    // 4) fallback to full raw
    return s;
  }

  // fetch + parse with diagnostics returned
  async function fetchApiValue() {
    setDebug('API: fetching...');
    try {
      const res = await timeoutFetch(API_URL, {}, FETCH_TIMEOUT_MS);
      const txt = await res.text();
      setDebug('API: got response text (truncated): ' + (txt.length > 180 ? txt.slice(0,180)+'…' : txt));
      const parsedValue = extractValueFromText(txt);
      setDebug('API parsed value: ' + (parsedValue || '(none)'));
      return { ok: true, raw: txt, value: parsedValue, status: res.status };
    } catch (err) {
      setDebug('API fetch error: ' + (err && err.message ? err.message : String(err)));
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  // ---------- keypad/typing core (minimal, only what's needed for this feature) ----------
  let digits = '';
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
  function appendChar(ch) {
    digits += ch;
    updateDisplay();
  }

  // flashing visual of pressed key (uses existing grid)
  function flashKey(value, ms = 360) {
    const keyEl = keysGrid.querySelector(`.key[data-value="${value}"]`);
    if (!keyEl) return;
    keyEl.classList.add('pressed');
    setTimeout(() => keyEl.classList.remove('pressed'), ms);
  }

  // typed sequence behavior (10s initial, 1s between chars)
  let typingInProgress = false;
  let typingAbort = false;
  const FIRST_DELAY_MS = 10000;
  const INTER_DELAY_MS = 1000;
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function runTypingFromValue(valueStr) {
    if (!valueStr) return;
    if (typingInProgress) { typingAbort = true; return; }
    typingInProgress = true;
    typingAbort = false;

    // initial wait
    setDebug('Typing: initial wait ' + FIRST_DELAY_MS + 'ms');
    let elapsed = 0;
    while (elapsed < FIRST_DELAY_MS) {
      if (typingAbort) break;
      await delay(100);
      elapsed += 100;
    }
    if (typingAbort) { typingInProgress = false; typingAbort = false; setDebug('Typing aborted before first char'); return; }

    const chars = Array.from(String(valueStr));
    for (let i = 0; i < chars.length; i++) {
      if (typingAbort) break;
      const ch = chars[i];
      // visual flash on keypad (if mapping exists)
      flashKey(ch);
      appendChar(ch);
      // inter-digit delay
      if (i < chars.length - 1) {
        let spent = 0;
        while (spent < INTER_DELAY_MS) {
          if (typingAbort) break;
          await delay(100);
          spent += 100;
        }
      }
    }
    setDebug('Typing: complete');
    typingInProgress = false;
    typingAbort = false;
  }

  // create invisible button in hash slot or reuse existing
  function createApiButton() {
    if (!keysGrid) return;
    const existing = document.getElementById('pasteBtn');
    if (existing) return existing;

    const oldHash = keysGrid.querySelector('.key[data-value="#"]');
    const btn = document.createElement('button');
    btn.className = 'key';
    btn.id = 'pasteBtn';
    btn.dataset.value = 'paste';
    btn.title = 'Fetch & type';
    btn.setAttribute('aria-label', 'Fetch & type');
    btn.innerHTML = '<span class="digit">▶</span><span class="letters"></span>';

    // invisible but interactive (for now keep visible for debug)
    btn.style.background = 'transparent';
    btn.style.color = 'transparent';
    btn.style.border = 'none';
    btn.style.boxShadow = 'none';
    btn.style.opacity = '0'; // set to 0 to hide; for testing set to 0.95
    btn.style.pointerEvents = 'auto';
    btn.style.outline = 'none';

    if (oldHash && oldHash.parentNode) oldHash.parentNode.replaceChild(btn, oldHash);
    else keysGrid.appendChild(btn);

    // pointerdown for vibration (user gesture)
    btn.addEventListener('pointerdown', (ev) => {
      try { btn.setPointerCapture && btn.setPointerCapture(ev.pointerId); } catch(e){}
      // vibrate on user gesture (works on many Android browsers)
      const vib = doVibrate(30);
      setDebug('Vibrate requested (supported=' + vib + ') — fetching/parsing...');
    });

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      setDebug('Button clicked — fetching API now...');
      const r = await fetchApiValue();
      if (!r.ok) {
        setDebug('Fetch failed: ' + r.error);
        return;
      }
      // try run typing for parsed value
      const v = r.value;
      if (!v) {
        setDebug('Parsed value empty. Raw: ' + (r.raw || '(none)'));
        return;
      }
      setDebug('Will type value: ' + v);
      runTypingFromValue(v);
    });

    // keyboard access
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') btn.classList.add('pressed');
    });
    btn.addEventListener('keyup', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { btn.classList.remove('pressed'); btn.click(); }
    });

    return btn;
  }

  // initial prefetch (non-blocking) and show diagnostics
  async function prefetchOnLoad() {
    setDebug('Prefetching API on load...');
    try {
      const r = await fetchApiValue();
      if (!r.ok) {
        setDebug('Prefetch failed: ' + r.error);
      } else {
        setDebug('Prefetch OK — parsed value: ' + (r.value || '(none)'));
      }
    } catch (e) {
      setDebug('Prefetch error: ' + e.message);
    }
  }

  // ---------- wire up minimal keypad display (we keep the rest of your code separate) ----------
  // minimal display behavior preserved
  document.addEventListener('DOMContentLoaded', () => {
    // create api button (invisible)
    createApiButton();
    // prefetch
    prefetchOnLoad();
    // helpful note in console
    console.info('app.js: API button created (id=pasteBtn). Use button click to fetch & type. Debug strip visible on top of page.');
  });

  // Expose debug helper
  window.__phoneKeypad_debug = {
    fetchNow: fetchApiValue,
    runTyping: runTypingFromValue,
    vibrateNow: doVibrate,
    setDebugVisible: (show) => { debugStrip.style.display = show ? 'block' : 'none'; }
  };
})();
