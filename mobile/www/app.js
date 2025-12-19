// ======================= CONFIG =======================
const API_BASE = "";

// ================== DEVICE & API HELPERS ==================
function deviceId() {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem("device_id", id);
  }
  return id;
}

async function api(path, { method = "GET", json } = {}) {
  const url = `${API_BASE}${path}`;
  const init = {
    method,
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
    headers: {
      "X-User-Key": deviceId()
    }
  };
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  const r = await fetch(url, init);
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  return { ok: r.ok, status: r.status, data };
}

// ================== DOM SHORTCUTS ==================
const $ = s => document.querySelector(s);

// Inputs / outputs
const cat = $("#category");
const tone = $("#tone");
const lenEl = $("#len");
const out = $("#excuse");
const meta = $("#meta");

// Main buttons
const btnGo = $("#go");
const btnCopy = $("#copy");
const btnShare = $("#share");
const btnSave = $("#save");
const btnSurprise = $("#btnSurprise");
const btnUpgrade = $("#btnUpgrade");

// Settings / sheets
const settingsPanel = $("#settingsPanel");
const settingsClose = $("#settingsClose");
const btnRestore = $("#btnRestore");

const savedPanel = $("#savedPanel");
const savedClose = $("#savedClose");
const favList = $("#favList");
const historyList = $("#historyList");
const navSaved = $("#nav-saved");
const navGenerate = $("#nav-generate");
const navSettings = $("#nav-settings");

const planBadge = $("#planBadge");
const statusHint = $("#statusHint");

const backdrop = $("#backdrop");
const toast = $("#toast");

// Packs modal
const btnPacks = $("#btnPacks");
const packsModal = $("#packsModal");
const packsClose = $("#packsClose");
const packsOk = $("#packsOk");
const packsList = $("#packsList");

// ================== SETTINGS & HAPTICS ==================
const SETTINGS_KEY = "excuse_settings_v1";
const hapticsToggle = $("#hapticsToggle");
const defaultToneSel = $("#defaultTone");

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function applySettingsToUI(s) {
  if (s.defaultTone) tone.value = s.defaultTone;
  if (hapticsToggle) hapticsToggle.checked = !!s.haptics;
  if (defaultToneSel) defaultToneSel.value = tone.value;
}

(function initSettings() {
  applySettingsToUI(loadSettings());
})();

defaultToneSel?.addEventListener("change", () => {
  const s = loadSettings();
  s.defaultTone = defaultToneSel.value;
  saveSettings(s);
  tone.value = s.defaultTone;
});

hapticsToggle?.addEventListener("change", () => {
  const s = loadSettings();
  s.haptics = hapticsToggle.checked;
  saveSettings(s);
});

function vibrate(ms = 20) {
  try {
    if (loadSettings().haptics && navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}

// ================== HISTORY / FAVORITES ==================
const HISTORY_KEY = "excuse_history_v1";
const FAV_KEY = "excuse_favs_v1";

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(a) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(a.slice(0, 200)));
}

function addHistory(e) {
  const a = loadHistory();
  a.unshift(e);
  saveHistory(a);
}

function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveFavs(a) {
  localStorage.setItem(FAV_KEY, JSON.stringify(a.slice(0, 500)));
}

function renderHistory() {
  const items = loadHistory();
  if (!items.length) {
    historyList.innerHTML = '<div class="hist-item">No history yet. Generate a few!</div>';
    return;
  }
  historyList.innerHTML = items
    .map(
      (it, i) => `
    <div class="hist-item">
      <div>${it.text}</div>
      <div class="hist-meta">${it.category} • ${it.tone} • ${new Date(it.ts).toLocaleString()}</div>
      <div class="row-actions">
        <button class="btn small ghost" data-act="use"  data-i="${i}">Use</button>
        <button class="btn small ghost" data-act="fav"  data-i="${i}">Save ☆</button>
        <button class="btn small ghost" data-act="copy" data-i="${i}">Copy</button>
      </div>
    </div>`
    )
    .join("");
  historyList.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      const act = b.dataset.act,
        i = +b.dataset.i,
        it = items[i];
      if (!it) return;
      if (act === "use") {
        out.textContent = it.text;
        cat.value = it.category;
        tone.value = it.tone;
        closeSheet(savedPanel);
        smoothToOutput();
      }
      if (act === "fav") {
        addToFav(it.text, it.category, it.tone);
        showToast("Saved to favorites");
      }
      if (act === "copy") {
        navigator.clipboard.writeText(it.text);
        showToast("Copied");
      }
    });
  });
}

function renderFavs() {
  const favs = loadFavs();
  if (!favs.length) {
    favList.innerHTML = '<div class="hist-item">No favorites yet.</div>';
    return;
  }
  favList.innerHTML = favs
    .map(
      (it, i) => `
    <div class="hist-item">
      <div>${it.text}</div>
      <div class="hist-meta">${it.category} • ${it.tone}</div>
      <div class="row-actions">
        <button class="btn small ghost" data-act="use" data-i="${i}">Use</button>
        <button class="btn small ghost" data-act="copy" data-i="${i}">Copy</button>
        <button class="btn small ghost" data-act="del" data-i="${i}">Delete</button>
      </div>
    </div>`
    )
    .join("");
  favList.querySelectorAll("button").forEach(b => {
    b.addEventListener("click", () => {
      const act = b.dataset.act,
        i = +b.dataset.i,
        arr = loadFavs(),
        it = arr[i];
      if (!it) return;
      if (act === "use") {
        out.textContent = it.text;
        cat.value = it.category;
        tone.value = it.tone;
        closeSheet(savedPanel);
        smoothToOutput();
      }
      if (act === "copy") {
        navigator.clipboard.writeText(it.text);
        showToast("Copied");
      }
      if (act === "del") {
        arr.splice(i, 1);
        saveFavs(arr);
        renderFavs();
      }
    });
  });
}

function addToFav(text, category, toneVal) {
  if (!text?.trim()) return;
  const favs = loadFavs();
  favs.unshift({ text, category, tone: toneVal, ts: Date.now() });
  saveFavs(favs);
  renderFavs();
  pulseSaved();
}

// ================== SHEETS / MODALS ==================
function openSheet(el) {
  if (!el) return;
  el.setAttribute("aria-hidden", "false");
  el.classList.add("show");
  backdrop?.classList.add("show");
}

function closeSheet(el) {
  if (!el) return;
  el.setAttribute("aria-hidden", "true");
  el.classList.remove("show");
  const any = savedPanel?.classList.contains("show") || settingsPanel?.classList.contains("show");
  if (!any) backdrop?.classList.remove("show");
}

function openModal(m) {
  m.setAttribute("aria-hidden", "false");
  backdrop?.classList.add("show");
}

function closeModal(m) {
  m.setAttribute("aria-hidden", "true");
  backdrop?.classList.remove("show");
}

navSaved?.addEventListener("click", () => {
  renderFavs();
  renderHistory();
  openSheet(savedPanel);
});

savedClose?.addEventListener("click", () => closeSheet(savedPanel));
navSettings?.addEventListener("click", () => openSheet(settingsPanel));
settingsClose?.addEventListener("click", () => closeSheet(settingsPanel));
navGenerate?.addEventListener("click", () => surpriseFlow());

// ================== TOAST / POLISH ==================
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1300);
}

function smoothToOutput() {
  out.scrollIntoView({ behavior: "smooth", block: "center" });
}

function pulseSaved() {
  const btn = document.getElementById("nav-saved");
  btn.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], {
    duration: 600
  });
}

// ================== ENTITLEMENTS ==================
const PACKS = [
  { id: "work", name: "Corporate Survival", price: "$5.00" },
  { id: "date", name: "Dating Disaster", price: "$5.00" },
  { id: "parent", name: "Parent-Teacher", price: "$5.00" },
  { id: "gamer", name: "Gamer Pack", price: "$5.00" },
  { id: "holiday", name: "Holiday Family", price: "$5.00" },
  { id: "all", name: "All Access Bundle", price: "$19.99" },
  { id: "sub_monthly", name: "Pro Monthly", price: "$1.99/month" }
];

let currentEntitlements = { packs: [], pro: false };

async function fetchEntitlements() {
  const r = await api("/api/restore");
  if (r.ok) {
    currentEntitlements = r.data || { packs: [], pro: false };
    const plan = currentEntitlements.pro ? "pro" : "free";
    planBadge.textContent = plan;
    statusHint.textContent = currentEntitlements.pro
      ? "Pro access unlocked."
      : "Unlock packs for more options.";
    renderPacks();
  }
}

function renderPacks() {
  if (!packsList) return;
  const unlocked = new Set(currentEntitlements.packs || []);
  const isPro = currentEntitlements.pro;
  packsList.innerHTML = PACKS.map(pack => {
    const owned = isPro || unlocked.has(pack.id) || pack.id === "sub_monthly";
    const label = owned ? "Owned" : "Unlock";
    return `
      <div class="pack-card" data-id="${pack.id}">
        <div>
          <div class="pack-title">${pack.name}</div>
          <div class="pack-tag">${pack.price}</div>
        </div>
        <button class="btn pill" ${owned ? "disabled" : ""}>${label}</button>
      </div>`;
  }).join("");

  packsList.querySelectorAll(".pack-card").forEach(card => {
    card.addEventListener("click", async () => {
      const id = card.dataset.id;
      if (!id) return;
      if (currentEntitlements.pro || currentEntitlements.packs?.includes(id)) {
        showToast("Already unlocked");
        return;
      }
      await startCheckout(id, card);
    });
  });
}

async function startCheckout(packId, card) {
  const button = card.querySelector("button");
  if (button) {
    button.disabled = true;
    button.textContent = "Starting…";
  }
  try {
    const r = await api("/api/create-checkout-session", { method: "POST", json: { packId } });
    if (r.ok && r.data?.url) {
      window.location.href = r.data.url;
      return;
    }
    showToast("Checkout unavailable");
  } catch {
    showToast("Checkout failed");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Unlock";
    }
  }
}

btnUpgrade?.addEventListener("click", () => openModal(packsModal));
btnPacks?.addEventListener("click", () => openModal(packsModal));
packsClose?.addEventListener("click", () => closeModal(packsModal));
packsOk?.addEventListener("click", () => closeModal(packsModal));

btnRestore?.addEventListener("click", async () => {
  btnRestore.disabled = true;
  const old = btnRestore.textContent;
  btnRestore.textContent = "Checking…";
  try {
    await fetchEntitlements();
    showToast("Restore complete");
  } catch {
    statusHint.textContent = "Network error. Try again.";
  } finally {
    btnRestore.disabled = false;
    btnRestore.textContent = old;
  }
});

// ================== GENERATE ==================
async function generate() {
  out.textContent = "Thinking…";
  btnGo.disabled = true;
  try {
    const r = await api("/api/generate", {
      method: "POST",
      json: { category: cat.value, tone: tone.value, length: lenEl.value }
    });
    const data = r.data || {};
    if (!r.ok || !Array.isArray(data.excuses)) {
      out.textContent = "Couldn’t reach the server. Try again.";
      meta.textContent = JSON.stringify(data);
      return;
    }

    const text = data.excuses[Math.floor(Math.random() * data.excuses.length)] || "No excuse generated.";
    out.textContent = text;
    meta.textContent = `tone: ${tone.value} • category: ${cat.value}`;
    addHistory({ text, category: cat.value, tone: tone.value, ts: Date.now() });
    smoothToOutput();
  } catch (e) {
    out.textContent = "Couldn’t reach the server. Try again.";
    meta.textContent = String(e?.message || e);
  } finally {
    btnGo.disabled = false;
  }
}

btnGo.addEventListener("click", generate);

// ================== SURPRISE ==================
async function surpriseFlow() {
  try {
    const categories = ["work", "family", "medical", "school", "travel", "social"];
    const tones = ["apologetic", "confident", "humorous"];
    cat.value = categories[Math.floor(Math.random() * categories.length)];
    tone.value = tones[Math.floor(Math.random() * tones.length)];
    await generate();
  } catch {
    out.textContent = "Couldn’t reach the server. Try again.";
  }
}

btnSurprise.addEventListener("click", surpriseFlow);

// ================== Share / Copy / Save ==================
btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(out.textContent.trim());
    showToast("Copied");
  } catch {}
  vibrate(15);
});

btnShare.addEventListener("click", async () => {
  const text = out.textContent.trim();
  if (!text) return;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      showToast("Copied");
    }
  } catch {}
  vibrate(30);
});

btnSave.addEventListener("click", () => {
  const t = out.textContent.trim();
  if (!t) return;
  addToFav(t, cat.value, tone.value);
  showToast("Saved");
});

// ================== FIRST LOAD ==================
fetchEntitlements();
