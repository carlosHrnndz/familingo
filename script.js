"use strict";
/* ============================================================================
   Familingo — Motor modular (v3)
   ----------------------------------------------------------------------------
   ARQUITECTURA DE DATOS
   - El contenido vive en /data como JSON independientes por sección:
       data/manifest.json    -> índice ligero (pestañas, colores, nº unidades)
       data/section_N.json   -> Sección -> Unidad -> Lección -> Ejercicio
   - Carga dinámica: cada sección se descarga con fetch() SOLO cuando el
     usuario entra en ella, y se cachea en memoria (sectionCache).
   - Esquema estricto documentado en types.d.ts.
   - Tipos de ejercicio: select_image | word_bank | translate_direct |
     listening_match (TTS de-DE del navegador) + lección minijuego match_game.

   PROGRESO (Supabase + localStorage, igual que v2)
   - state.units = { "s1_u1": nLeccionesCompletadas } ; unidad coronada al
     llegar a LESSONS_PER_UNIT. Realtime multidispositivo sin cambios.
   ========================================================================== */

/* =========================== CONFIG / PERFILES =========================== */
const MAX_HEARTS = 5;
const LESSONS_PER_UNIT = 5;   // toda unidad "ready" tiene exactamente 5 lecciones
const DATA_BASE = "data/";
const HEART_REGEN_MS = 30 * 60 * 1000; // +1 corazón cada 30 minutos
const DAILY_GOAL = 20;                 // objetivo diario en XP
const MISTAKES_CAP = 20;               // máximo de errores guardados por perfil
const USERS = [
  { name: "Antón",  icon: "🐧", color: "#58cc02" },
  { name: "Pepa",   icon: "🦄", color: "#ff86d0" },
  { name: "Lázaro", icon: "🦊", color: "#ff9600" },
  { name: "Carlos", icon: "🦁", color: "#1cb0f6" },
];
const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

/* =============================== ESTADO ================================== */
let manifest = null;              // data/manifest.json
const sectionCache = new Map();   // index -> Section (ya descargada)

let currentUser = null;
let state = null;                 // {hearts, xp, streak, lastActive, units:{id:n}}
let cloudOK = false;
let channel = null;
let pendingRemote = null;
let session = null;               // lección en curso
let activeSection = 1;            // 1..4

function defaultState() {
  return {
    hearts: MAX_HEARTS, xp: 0, streak: 0, lastActive: null, units: {},
    heartsTs: null,          // timestamp desde el que se regeneran corazones
    mistakes: [],            // ejercicios fallados: {sec, u, l, q}
    weekId: null, weekXp: 0, // XP de la semana (liga familiar)
    dayId: null, dayXp: 0,   // XP de hoy (objetivo diario)
  };
}
function lsKey(name) { return "familingo_u_" + name; }
function loadLocal(name) {
  try {
    const raw = localStorage.getItem(lsKey(name));
    return raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
  } catch (e) { return defaultState(); }
}
function saveLocal() {
  if (currentUser) localStorage.setItem(lsKey(currentUser.name), JSON.stringify(state));
}

/* ======================= CARGA DINÁMICA DE CONTENIDO ===================== */
async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status + " al cargar " + path);
  return res.json();
}

async function loadManifest() {
  if (!manifest) manifest = await fetchJSON(DATA_BASE + "manifest.json");
  return manifest;
}

async function loadSection(index) {
  if (sectionCache.has(index)) return sectionCache.get(index);
  const meta = manifest.sections[index - 1];
  const file = await fetchJSON(DATA_BASE + meta.file);
  if (!file || file.schema_version !== 1 || !file.section || !Array.isArray(file.section.units)) {
    throw new Error("Esquema inválido en " + meta.file);
  }
  sectionCache.set(index, file.section);
  return file.section;
}

/* ====================== PROGRESO / DESBLOQUEO ============================ */
function lessonsDoneId(unitId) { return state.units[unitId] || 0; }
function unitCompleted(unit) {
  return unit.status === "ready" && lessonsDoneId(unit.id) >= LESSONS_PER_UNIT;
}
function sectionCompletedCount(index) {
  const prefix = "s" + index + "_";
  let n = 0;
  for (const [k, v] of Object.entries(state.units)) {
    if (k.startsWith(prefix) && v >= LESSONS_PER_UNIT) n++;
  }
  return n;
}
function sectionUnlocked(index) {
  if (index === 1) return true;
  const prevMeta = manifest.sections[index - 2];
  return prevMeta.ready_units > 0 && sectionCompletedCount(index - 1) >= prevMeta.ready_units;
}
function unitUnlocked(section, unit) {
  if (unit.status !== "ready") return false;
  if (!sectionUnlocked(section.index)) return false;
  if (unit.index === 1) return true;
  const prev = section.units[unit.index - 2];
  return prev.status === "ready" && unitCompleted(prev);
}
function sectionProgress(index) {
  const meta = manifest.sections[index - 1];
  return { done: sectionCompletedCount(index), total: meta.ready_units, declared: meta.units_total };
}

// Posición actual (columnas de la tabla). Nota: current_unit se limita a 10
// por la restricción CHECK de la BD; la posición completa vive en `progress`.
function computeDerived() {
  if (!manifest) return { level: 1, unit: 1, lesson: 1 };
  for (const meta of manifest.sections) {
    if (meta.ready_units === 0) continue;
    const done = sectionCompletedCount(meta.index);
    if (done < meta.ready_units) {
      const prefix = "s" + meta.index + "_u";
      let unit = done + 1, lesson = 1;
      for (const [k, v] of Object.entries(state.units)) {
        if (k.startsWith(prefix) && v > 0 && v < LESSONS_PER_UNIT) {
          unit = parseInt(k.slice(prefix.length), 10) || unit;
          lesson = v + 1;
          break;
        }
      }
      return { level: meta.index, unit: Math.min(10, unit), lesson: Math.min(LESSONS_PER_UNIT, lesson) };
    }
  }
  return { level: 1, unit: 10, lesson: LESSONS_PER_UNIT };
}

/* Racha diaria: compara la fecha del sistema con la última lección completada.
   - touchStreak(): se llama al completar una lección; suma si ayer también
     se practicó, reinicia a 1 si hubo un hueco.
   - effectiveStreak(): valor a MOSTRAR; si el último día activo no es hoy
     ni ayer, la racha está rota y se enseña 0. */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }

function touchStreak() {
  const today = todayStr();
  if (state.lastActive === today) return;
  state.streak = state.lastActive === yesterdayStr() ? state.streak + 1 : 1;
  state.lastActive = today;
}
function effectiveStreak() {
  if (state.lastActive === todayStr() || state.lastActive === yesterdayStr()) return state.streak;
  return 0;
}

/* ---------------- XP con contadores diario y semanal --------------------- */
function weekId() {
  const d = new Date();
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return y + "-W" + String(w).padStart(2, "0");
}
function addXp(gained) {
  state.xp += gained;
  const today = todayStr(), wk = weekId();
  if (state.dayId !== today) { state.dayId = today; state.dayXp = 0; }
  if (state.weekId !== wk) { state.weekId = wk; state.weekXp = 0; }
  const before = state.dayXp;
  state.dayXp += gained;
  state.weekXp += gained;
  if (before < DAILY_GOAL && state.dayXp >= DAILY_GOAL) sfx("win"); // ¡objetivo diario!
}
function todayXp() { return state.dayId === todayStr() ? state.dayXp : 0; }

/* -------------- Regeneración de corazones por tiempo --------------------- */
function applyHeartRegen() {
  if (state.hearts >= MAX_HEARTS) { state.heartsTs = null; return false; }
  const ts = state.heartsTs || Date.now();
  const regenerated = Math.floor((Date.now() - ts) / HEART_REGEN_MS);
  if (regenerated <= 0) { state.heartsTs = ts; return false; }
  state.hearts = Math.min(MAX_HEARTS, state.hearts + regenerated);
  state.heartsTs = state.hearts >= MAX_HEARTS ? null : ts + regenerated * HEART_REGEN_MS;
  return true;
}
function minsToNextHeart() {
  if (state.hearts >= MAX_HEARTS || !state.heartsTs) return null;
  const ms = state.heartsTs + HEART_REGEN_MS - Date.now();
  return Math.max(1, Math.ceil(ms / 60000));
}
let regenTimer = null;
function clearRegenTimer() { if (regenTimer) { clearInterval(regenTimer); regenTimer = null; } }

/* ------------------- Repaso inteligente de errores ----------------------- */
function mistakeKey(r) { return r.sec + "|" + r.u + "|" + r.l + "|" + r.q; }
function addMistake(r) {
  if (!r) return;
  if (!Array.isArray(state.mistakes)) state.mistakes = [];
  if (state.mistakes.some((m) => mistakeKey(m) === mistakeKey(r))) return;
  state.mistakes.push(r);
  if (state.mistakes.length > MISTAKES_CAP) state.mistakes.shift();
}
function removeMistake(r) {
  if (!r || !Array.isArray(state.mistakes)) return;
  state.mistakes = state.mistakes.filter((m) => mistakeKey(m) !== mistakeKey(r));
}

/* ------------- Efectos de sonido (WebAudio, sin archivos) ---------------- */
let audioCtx = null;
function sfx(kind) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const note = (freq, start, dur, type = "sine", gain = 0.14) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t + start);
      g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t + start); o.stop(t + start + dur);
    };
    if (kind === "ok") { note(660, 0, 0.12); note(880, 0.12, 0.2); }
    else if (kind === "bad") { note(220, 0, 0.2, "square", 0.07); note(160, 0.15, 0.25, "square", 0.07); }
    else if (kind === "win") { [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.12, 0.28)); }
    else if (kind === "match") { note(740, 0, 0.09, "triangle", 0.12); }
  } catch (e) { /* sin audio */ }
}

/* -------------------------- Confeti (CSS puro) --------------------------- */
function confettiBurst() {
  const colors = ["#58cc02", "#1cb0f6", "#ffc800", "#ff4b4b", "#ce82ff", "#ff9600"];
  const wrap = document.createElement("div");
  wrap.className = "confetti-wrap";
  for (let i = 0; i < 60; i++) {
    const c = document.createElement("i");
    c.style.left = Math.random() * 100 + "%";
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = (Math.random() * 0.6).toFixed(2) + "s";
    c.style.animationDuration = (1.6 + Math.random()).toFixed(2) + "s";
    wrap.appendChild(c);
  }
  app.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3500);
}

/* ============================ CAPA DE NUBE =============================== */
function rowToState(row) {
  const p = row.progress || {};
  return {
    hearts: typeof row.hearts === "number" ? Math.max(0, Math.min(MAX_HEARTS, row.hearts)) : MAX_HEARTS,
    xp: row.xp_total || 0,
    streak: row.streak_count || 0,
    lastActive: row.last_active || null,
    units: (p && p.units) || {},
    heartsTs: (p && p.heartsTs) || null,
    mistakes: (p && Array.isArray(p.mistakes)) ? p.mistakes : [],
    weekId: (p && p.week && p.week.id) || null,
    weekXp: (p && p.week && p.week.xp) || 0,
    dayId: (p && p.day && p.day.id) || null,
    dayXp: (p && p.day && p.day.xp) || 0,
  };
}

async function cloudLoad(name) {
  const sb = window.supabaseClient;
  if (!sb) return null;
  const { data, error } = await sb
    .from("user_progress").select("*").eq("user_name", name).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: e2 } = await sb
    .from("user_progress")
    .upsert({ user_name: name }, { onConflict: "user_name" })
    .select().single();
  if (e2) throw e2;
  return created;
}

async function cloudSave() {
  const sb = window.supabaseClient;
  if (!sb || !currentUser) return;
  const d = computeDerived();
  try {
    const { error } = await sb.from("user_progress").upsert({
      user_name: currentUser.name,
      current_level: d.level,
      current_unit: d.unit,
      current_lesson: d.lesson,
      streak_count: state.streak,
      xp_total: state.xp,
      hearts: state.hearts,
      last_active: state.lastActive,
      progress: {
        units: state.units,
        heartsTs: state.heartsTs,
        mistakes: state.mistakes,
        week: { id: state.weekId, xp: state.weekXp },
        day: { id: state.dayId, xp: state.dayXp },
      },
      last_client: CLIENT_ID,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_name" });
    if (error) throw error;
    cloudOK = true;
  } catch (e) {
    console.warn("[Familingo] No se pudo guardar en la nube:", e.message || e);
    cloudOK = false;
  }
}

function persist() { saveLocal(); cloudSave(); }

function subscribeRealtime(name) {
  const sb = window.supabaseClient;
  if (!sb) return;
  if (channel) { sb.removeChannel(channel); channel = null; }
  channel = sb
    .channel("progress-" + name)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "user_progress", filter: "user_name=eq." + name },
      (payload) => {
        const row = payload.new;
        if (!row || row.last_client === CLIENT_ID) return;
        const remote = rowToState(row);
        if (session) { pendingRemote = remote; }
        else { state = remote; saveLocal(); renderDashboard(); }
      })
    .subscribe();
}
function unsubscribeRealtime() {
  const sb = window.supabaseClient;
  if (sb && channel) { sb.removeChannel(channel); channel = null; }
}

/* ============================ UTILIDADES ================================= */
const app = document.getElementById("app");

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function normForms(s) {
  let t = String(s).toLowerCase().trim()
    .replace(/ß/g, "ss")
    .replace(/[.,!?¿¡;:'"„“”‚’()]/g, "")
    .replace(/\s+/g, " ");
  const expanded = t.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
  const base = t.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
  return [t, expanded, base];
}
function translationMatches(input, ex) {
  const candidates = [ex.answer].concat(ex.accepted || []);
  const inputForms = normForms(input);
  return candidates.some((c) => {
    const candForms = normForms(c);
    return inputForms.some((f) => candForms.includes(f));
  });
}
/* TTS con voz alemana. En iOS/Android el sintetizador solo funciona tras un
   gesto del usuario: unlockTTS() se engancha al PRIMER toque de la sesión y
   "calienta" el motor con un utterance silencioso. */
let deVoice = null;
let ttsUnlocked = false;

function pickGermanVoice() {
  try {
    const voices = window.speechSynthesis.getVoices();
    deVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("de")) || null;
  } catch (e) { /* sin voces aún */ }
}
if ("speechSynthesis" in window) {
  pickGermanVoice();
  window.speechSynthesis.onvoiceschanged = pickGermanVoice;
}
function unlockTTS() {
  // Desbloquea también el AudioContext de los efectos de sonido
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.resume) audioCtx.resume();
  } catch (e) { /* nada */ }
  if (ttsUnlocked || !("speechSynthesis" in window)) return;
  ttsUnlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.lang = "de-DE";
    window.speechSynthesis.speak(u);
    pickGermanVoice();
  } catch (e) { /* nada */ }
}
document.addEventListener("pointerdown", unlockTTS, { once: true, capture: true });

function speak(text) {
  try {
    if (!("speechSynthesis" in window) || !text) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    if (deVoice) u.voice = deVoice;
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}
/* ---------------- Audio nativo (MP3 local) con fallback a TTS -------------
   Ruta esperada: audio/unit_[unit.id]/lesson_[lesson.index]/q_[qid].mp3
   Ej.: audio/unit_s1_u1/lesson_3/q_2.mp3
   Si el MP3 no existe todavía (404) o falla la reproducción, se usa el
   sintetizador de-DE del navegador para no romper la experiencia. */
let audioPlayer = null;

function audioPathFor(ex) {
  return `audio/unit_${session.unit.id}/lesson_${session.lesson.index}/q_${ex._qid}.mp3`;
}
// Texto alemán canónico de cada ejercicio (también lo usa el fallback TTS)
function germanTextFor(ex) {
  if (ex.type === "listening_match") return ex.tts;
  if (ex.type === "word_bank") return ex.words.join(" ");
  if (ex.type === "translate_direct") return ex.answer;
  if (ex.type === "select_image") {
    const o = ex.options.find((o) => o.id === ex.correct);
    return o ? o.label : "";
  }
  return "";
}
/* Caché de existencia de MP3. Se precarga (HEAD) al iniciar la lección para
   que, en el momento del click, la decisión MP3-vs-TTS sea SÍNCRONA y el TTS
   se dispare dentro del gesto del usuario (imprescindible en móvil). */
const audioExists = new Map(); // ruta -> boolean

function prefetchLessonAudio() {
  if (!session || !session.exercises) return;
  session.exercises.forEach((ex) => {
    const p = ex._audio || audioPathFor(ex);
    if (audioExists.has(p)) return;
    fetch(p, { method: "HEAD" })
      .then((r) => audioExists.set(p, r.ok))
      .catch(() => audioExists.set(p, false));
  });
}

function playExerciseAudio(ex) {
  const p = ex._audio || audioPathFor(ex);
  const fallback = germanTextFor(ex);
  if (audioExists.get(p) === true) {
    try {
      if (audioPlayer) { audioPlayer.pause(); audioPlayer = null; }
      const a = new Audio(p);
      audioPlayer = a;
      a.onerror = () => speak(fallback);
      a.play().catch(() => speak(fallback));
      return;
    } catch (e) { /* cae al TTS */ }
  }
  // Sin MP3 (o aún sin verificar): TTS síncrono dentro del gesto
  speak(fallback);
}

function heartsHTML(size) {
  const cls = size === "sm" ? "text-lg" : "text-2xl";
  let out = "";
  for (let i = 0; i < MAX_HEARTS; i++) {
    out += `<span class="${cls} ${i < state.hearts ? "" : "opacity-25 grayscale"}">❤️</span>`;
  }
  return `<span id="hearts" class="flex items-center gap-0.5">${out}</span>`;
}
function cloudBadge() {
  if (!window.supabaseClient) return `<span title="Modo local" class="text-xs">📴</span>`;
  return cloudOK
    ? `<span title="Sincronizado en la nube" class="text-xs">☁️</span>`
    : `<span title="Sin conexión" class="text-xs">📴</span>`;
}
function showLoading(msg) {
  app.innerHTML = `
    <main class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
      <div class="text-5xl animate-bounce">🦉</div>
      <div class="font-extrabold text-[#8a9ba5]">${esc(msg)}</div>
    </main>`;
}
function showDataError(err, retryFn) {
  app.innerHTML = `
    <main class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
      <div class="text-5xl">🙈</div>
      <div class="font-extrabold text-[#ff4b4b]">No se pudo cargar el contenido</div>
      <p class="text-sm text-[#8a9ba5] font-semibold max-w-sm">${esc(err.message || String(err))}.
        Si estás abriendo el archivo directamente (file://), el navegador bloquea fetch:
        prueba desde GitHub Pages o con un servidor local.</p>
      <button id="retryBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302]">Reintentar</button>
    </main>`;
  document.getElementById("retryBtn").addEventListener("click", retryFn);
}

/* ====================== PANTALLA: SELECCIÓN DE PERFIL ==================== */
function renderProfileSelect() {
  unsubscribeRealtime();
  clearRegenTimer();
  currentUser = null;
  session = null;

  app.innerHTML = `
    <main class="scroll-area flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <div class="text-6xl mb-3 pop-in">🦉</div>
      <h1 class="text-3xl font-extrabold mb-1" style="color:#58cc02">Familingo</h1>
      <p class="text-[#8a9ba5] font-bold mb-8">¿Quién va a practicar alemán?</p>
      <div class="grid grid-cols-2 gap-4 w-full max-w-sm">
        ${USERS.map((u, i) => `
          <button data-i="${i}" class="profile-btn btn3d rounded-3xl border-2 p-5 flex flex-col items-center gap-2 bg-[#202f36]"
            style="border-color:${u.color};border-bottom-color:${u.color}">
            <span class="text-5xl">${u.icon}</span>
            <span class="font-extrabold text-lg" style="color:${u.color}">${esc(u.name)}</span>
            <span class="text-xs font-bold text-[#8a9ba5]" data-stats="${esc(u.name)}">&nbsp;</span>
          </button>`).join("")}
      </div>
      <p class="mt-8 text-xs text-[#52656d] font-semibold max-w-xs">
        El progreso de cada perfil se guarda en la nube y se sincroniza entre todos los dispositivos.
      </p>
    </main>`;

  app.querySelectorAll(".profile-btn").forEach((b) =>
    b.addEventListener("click", () => selectUser(USERS[+b.dataset.i]))
  );

  const sb = window.supabaseClient;
  if (sb) {
    sb.from("user_progress").select("user_name,xp_total,streak_count")
      .then(({ data, error }) => {
        if (error || !data) return;
        data.forEach((row) => {
          const el = app.querySelector(`[data-stats="${CSS.escape(row.user_name)}"]`);
          if (el) el.textContent = `⚡ ${row.xp_total} XP · 🔥 ${row.streak_count}`;
        });
      });
  }
}

async function selectUser(u) {
  currentUser = u;
  state = loadLocal(u.name);
  cloudOK = false;
  showLoading(`Cargando el progreso de ${u.name}…`);

  if (window.supabaseClient) {
    try {
      const row = await cloudLoad(u.name);
      if (row) {
        state = rowToState(row);
        saveLocal();
        cloudOK = true;
        subscribeRealtime(u.name);
      }
    } catch (e) {
      console.warn("[Familingo] Nube no disponible, modo local:", e.message || e);
    }
  }

  try {
    await loadManifest();
  } catch (e) {
    showDataError(e, () => selectUser(u));
    return;
  }

  activeSection = computeDerived().level;
  renderDashboard();
}

/* ============================ DASHBOARD ================================== */
async function renderDashboard() {
  if (!currentUser) { renderProfileSelect(); return; }
  if (pendingRemote) { state = pendingRemote; pendingRemote = null; saveLocal(); }
  session = null;
  clearRegenTimer();
  if (applyHeartRegen()) persist(); // corazones regenerados por tiempo

  let section;
  try {
    await loadManifest();
    showLoading("Cargando sección…");
    section = await loadSection(activeSection);
  } catch (e) {
    showDataError(e, renderDashboard);
    return;
  }

  const meta = manifest.sections[activeSection - 1];
  const prog = sectionProgress(activeSection);
  const offsets = [0, -70, -110, -70, 0, 70, 110, 70];

  const tabs = manifest.sections.map((m) => {
    const locked = !sectionUnlocked(m.index);
    const active = m.index === activeSection;
    return `<button data-sec="${m.index}" class="tab-btn btn3d flex-1 py-2 px-1 rounded-2xl font-extrabold text-sm border-2
      ${active ? "text-white" : "text-[#8a9ba5] bg-[#131f24] border-[#37464f] border-b-[#37464f]"}"
      style="${active ? `background:${m.color};border-color:${m.dark};` : ""}">
      ${locked ? "🔒 " : ""}${m.tag}
    </button>`;
  }).join("");

  const nodes = section.units.map((unit, i) => {
    const ready = unit.status === "ready";
    const completed = unitCompleted(unit);
    const unlocked = unitUnlocked(section, unit);
    const isNext = unlocked && !completed;
    const done = lessonsDoneId(unit.id);
    const off = offsets[i % offsets.length];

    let circleStyle, inner, extraCls = "";
    if (completed) {
      circleStyle = "background:#ffc800;border-color:#e6a800;";
      inner = "👑";
    } else if (isNext) {
      circleStyle = `background:${section.color};border-color:${section.dark};`;
      inner = unit.icon;
      extraCls = "node-active";
    } else if (!ready) {
      circleStyle = "background:#2b3940;border-color:#233037;";
      inner = "🚧";
      extraCls = "node-locked";
    } else {
      circleStyle = "background:#37464f;border-color:#2b3940;";
      inner = "🔒";
      extraCls = "node-locked";
    }

    return `
      <div class="flex flex-col items-center" style="transform:translateX(${off}px)">
        ${isNext ? `<div class="pop-in mb-1 text-xs font-extrabold uppercase tracking-wide px-3 py-1 rounded-xl border-2 border-[#37464f] bg-[#131f24]" style="color:${section.color}">${done > 0 ? `Lección ${done + 1}/${LESSONS_PER_UNIT}` : "Empezar"}</div>` : ""}
        <button data-u="${i}"
          class="node-btn ${extraCls} w-[74px] h-[74px] rounded-full border-b-8 border-2 flex items-center justify-center text-3xl"
          style="${circleStyle}" ${unlocked ? "" : "disabled"}>
          ${inner}
        </button>
        <div class="mt-1 text-xs font-bold ${unlocked ? "text-white" : "text-[#52656d]"} text-center w-28">
          ${esc(unit.title)}${!ready ? '<br><span class="text-[#52656d]">(próximamente)</span>' : ""}
        </div>
      </div>`;
  }).join('<div class="h-5"></div>');

  app.innerHTML = `
    <header class="shrink-0 bg-[#131f24] border-b-2 border-[#37464f] px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <button id="userChip" title="Cambiar de perfil"
          class="flex items-center gap-2 rounded-2xl border-2 border-[#37464f] bg-[#202f36] px-3 py-1.5 font-extrabold">
          <span class="text-xl">${currentUser.icon}</span>
          <span style="color:${currentUser.color}">${esc(currentUser.name)}</span>
          ${cloudBadge()}
        </button>
        <div class="flex items-center gap-3">
          <button id="leagueBtn" title="Liga familiar" class="text-xl">🏆</button>
          <span class="font-extrabold text-[#ff9600]" title="Racha diaria">🔥 ${effectiveStreak()}</span>
          <span class="font-extrabold text-[#ffc800]">⚡ ${state.xp}</span>
          ${heartsHTML("sm")}
        </div>
      </div>
      <div class="flex gap-2 mt-3">${tabs}</div>
    </header>

    <main class="scroll-area flex-1 px-4 pb-16">
      <section class="mt-4 rounded-2xl p-4 border-2" style="background:${meta.color}18;border-color:${meta.color}55">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-extrabold uppercase tracking-widest" style="color:${meta.color}">Sección ${meta.index} · ${meta.tag}</div>
            <div class="text-xl font-extrabold">${esc(meta.title)}</div>
          </div>
          <div class="text-sm font-bold text-[#8a9ba5]">${prog.done}/${prog.total > 0 ? prog.total : "—"} unidades</div>
        </div>
        <div class="mt-3 h-3 rounded-full bg-[#37464f] overflow-hidden">
          <div class="progress-fill h-full rounded-full" style="width:${prog.total ? (prog.done / prog.total) * 100 : 0}%;background:${meta.color}"></div>
        </div>
        ${!sectionUnlocked(activeSection) ? `<div class="mt-3 text-sm font-bold text-[#ff9600]">🔒 Completa la sección anterior para desbloquear estas unidades.</div>` : ""}
        ${prog.total === 0 ? `<div class="mt-3 text-sm font-bold text-[#8a9ba5]">🚧 Contenido en preparación.</div>` : ""}
      </section>

      <section class="mt-3 rounded-2xl border-2 border-[#37464f] p-3 flex items-center gap-3">
        <span class="font-extrabold text-sm shrink-0">🎯 Hoy</span>
        <div class="flex-1 h-3 rounded-full bg-[#37464f] overflow-hidden">
          <div class="progress-fill h-full rounded-full" style="width:${Math.min(100, (todayXp() / DAILY_GOAL) * 100)}%;background:#ffc800"></div>
        </div>
        <span class="text-xs font-extrabold text-[#ffc800] shrink-0">${todayXp()}/${DAILY_GOAL} ⚡${todayXp() >= DAILY_GOAL ? " ✅" : ""}</span>
        ${state.hearts < MAX_HEARTS && minsToNextHeart() ? `<span class="text-xs font-bold text-[#8a9ba5] shrink-0" title="Los corazones se regeneran solos">❤️ +1 en ${minsToNextHeart()}m</span>` : ""}
      </section>

      ${(state.mistakes || []).length > 0 ? `
      <button id="mistakesBtn" class="btn3d mt-3 w-full rounded-2xl border-2 border-[#ff4b4b] border-b-[#c93636] bg-[#ff4b4b]/10 px-4 py-3 font-extrabold text-[#ff4b4b] text-left">
        🩹 Repasar mis errores (${state.mistakes.length}) — ¡conviértelos en aciertos!
      </button>` : ""}

      <section class="mt-8 flex flex-col items-center">${nodes}</section>

      <div class="mt-10 text-center">
        <button id="resetBtn" class="text-xs font-bold text-[#52656d] underline">Reiniciar el progreso de ${esc(currentUser.name)}</button>
      </div>
    </main>`;

  document.getElementById("userChip").addEventListener("click", renderProfileSelect);
  document.getElementById("leagueBtn").addEventListener("click", renderLeague);
  const mistakesBtn = document.getElementById("mistakesBtn");
  if (mistakesBtn) mistakesBtn.addEventListener("click", startMistakesLesson);
  app.querySelectorAll(".tab-btn").forEach((b) =>
    b.addEventListener("click", () => { activeSection = +b.dataset.sec; renderDashboard(); })
  );
  app.querySelectorAll(".node-btn:not([disabled])").forEach((b) =>
    b.addEventListener("click", () => startLesson(section, section.units[+b.dataset.u]))
  );
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm(`¿Borrar todo el progreso de ${currentUser.name} (también en la nube)?`)) {
      state = defaultState();
      persist();
      activeSection = 1;
      renderDashboard();
    }
  });
}

/* ========================== LIGA FAMILIAR (🏆) =========================== */
async function renderLeague() {
  clearRegenTimer();
  showLoading("Cargando la liga familiar…");
  const wk = weekId();
  let rows = null;
  const sb = window.supabaseClient;
  if (sb) {
    try {
      const { data, error } = await sb
        .from("user_progress")
        .select("user_name,xp_total,streak_count,progress");
      if (!error && data) rows = data;
    } catch (e) { /* modo local */ }
  }
  // Sin nube: mostrar solo el perfil actual con sus datos locales
  if (!rows) {
    rows = [{
      user_name: currentUser.name, xp_total: state.xp, streak_count: state.streak,
      progress: { week: { id: state.weekId, xp: state.weekXp } },
    }];
  }
  const entries = rows.map((r) => {
    const u = USERS.find((x) => x.name === r.user_name) || { icon: "👤", color: "#8a9ba5" };
    const w = r.progress && r.progress.week;
    return {
      name: r.user_name, icon: u.icon, color: u.color,
      week: w && w.id === wk ? (w.xp || 0) : 0,
      total: r.xp_total || 0, streak: r.streak_count || 0,
    };
  }).sort((a, b) => b.week - a.week || b.total - a.total);
  const medals = ["🥇", "🥈", "🥉", "4º"];

  app.innerHTML = `
    <header class="shrink-0 bg-[#131f24] border-b-2 border-[#37464f] px-4 py-3 flex items-center gap-3">
      <button id="backBtn" class="text-[#52656d] hover:text-white text-2xl font-bold px-1">←</button>
      <div class="text-xl font-extrabold text-[#ffc800]">🏆 Liga familiar</div>
    </header>
    <main class="scroll-area flex-1 px-4 py-6 max-w-xl w-full mx-auto">
      <p class="text-xs text-[#52656d] font-bold uppercase tracking-widest mb-4">Semana ${esc(wk)} · XP de esta semana</p>
      <div class="flex flex-col gap-3">
        ${entries.map((e, i) => `
          <div class="rounded-2xl border-2 p-4 flex items-center gap-4 ${e.name === currentUser.name ? "bg-[#202f36]" : ""}"
            style="border-color:${e.name === currentUser.name ? e.color : "#37464f"}">
            <span class="text-2xl w-8 text-center">${medals[i] || (i + 1) + "º"}</span>
            <span class="text-3xl">${e.icon}</span>
            <div class="flex-1">
              <div class="font-extrabold" style="color:${e.color}">${esc(e.name)}</div>
              <div class="text-xs font-bold text-[#8a9ba5]">⚡ ${e.total} XP totales · 🔥 ${e.streak}</div>
            </div>
            <div class="text-xl font-extrabold text-[#ffc800]">${e.week} ⚡</div>
          </div>`).join("")}
      </div>
      <p class="mt-6 text-center text-xs text-[#52656d] font-semibold">La liga se reinicia cada lunes. ¡A por el 🥇!</p>
    </main>`;
  document.getElementById("backBtn").addEventListener("click", renderDashboard);
}

/* ============================== LECCIÓN ================================== */
function startLesson(section, unit) {
  clearRegenTimer();
  if (applyHeartRegen()) persist();
  if (state.hearts <= 0) { renderGameOver(); return; }
  const done = lessonsDoneId(unit.id);
  const review = done >= unit.lessons.length;
  const lesson = unit.lessons[review ? Math.floor(Math.random() * unit.lessons.length) : done];
  session = {
    section, unit, lesson, review,
    idx: 0, correct: 0, wrong: 0,
    // _qid: id estable (posición en el JSON); _audio: ruta del MP3;
    // _ref: identidad para el repaso de errores.
    exercises: lesson.kind === "exercises"
      ? shuffle(lesson.exercises.map((e, i) => Object.assign({
          _qid: i + 1,
          _audio: `audio/unit_${unit.id}/lesson_${lesson.index}/q_${i + 1}.mp3`,
          _ref: { sec: section.index, u: unit.id, l: lesson.index, q: i + 1 },
        }, e)))
      : null,
    // Total de ejercicios ÚNICOS: la barra avanza por ACIERTOS sobre este
    // total. Los fallos se re-encolan al final (estilo Duolingo).
    total: lesson.kind === "exercises" ? lesson.exercises.length
      : lesson.kind === "match_game" ? lesson.pairs.length : 1,
  };
  if (lesson.kind === "match_game") renderMatchGame();
  else if (lesson.kind === "theory") renderTheory();
  else { prefetchLessonAudio(); renderExercise(); }
}

/* ------------------------ Lección de teoría (📖) -------------------------
   Bloques: heading | text | vocab (tabla con audio) | example | tip.
   Sin corazones ni comprobación: leer, escuchar y "¡Entendido!". */
function renderTheory() {
  const c = session.section.color;
  const html = session.lesson.blocks.map((b) => {
    if (b.type === "heading") {
      return `<h2 class="text-xl font-extrabold mt-6 mb-2" style="color:${c}">${esc(b.text)}</h2>`;
    }
    if (b.type === "text") {
      return `<p class="text-[#c8d5dc] font-semibold mb-3">${esc(b.text)}</p>`;
    }
    if (b.type === "tip") {
      return `<div class="my-4 rounded-2xl border-2 border-[#ffc800] bg-[#ffc800]/10 p-3 font-bold text-[#ffc800]">💡 ${esc(b.text)}</div>`;
    }
    if (b.type === "example") {
      return `
        <div class="my-3 rounded-2xl border-2 border-[#37464f] bg-[#202f36] p-4">
          <div class="flex items-center gap-3">
            <button class="speak-btn btn3d rounded-xl px-3 py-1.5 text-lg bg-[#1cb0f6] border-[#1899d6]" data-tts="${esc(b.de)}">🔊</button>
            <span class="font-extrabold">${esc(b.de)}</span>
          </div>
          <div class="text-sm text-[#8a9ba5] font-semibold mt-2">${esc(b.es)}</div>
        </div>`;
    }
    if (b.type === "vocab") {
      return `<div class="rounded-2xl border-2 border-[#37464f] overflow-hidden my-3">` +
        b.items.map((it, i) => `
          <div class="flex items-center gap-3 px-4 py-2 ${i % 2 ? "bg-[#202f36]" : "bg-[#1a262c]"}">
            <button class="speak-btn text-xl" data-tts="${esc(it.de)}" title="Escuchar">🔊</button>
            <span class="font-extrabold flex-1">${esc(it.de)}</span>
            <span class="text-[#8a9ba5] font-bold">${esc(it.es)}</span>
          </div>`).join("") + `</div>`;
    }
    return "";
  }).join("");

  app.innerHTML = `
    ${lessonHeaderHTML(100)}
    <main class="scroll-area flex-1 px-5 py-6 max-w-xl w-full mx-auto" id="qArea">
      ${lessonMetaHTML()}
      ${html}
    </main>
    <footer class="app-footer border-t-2 border-[#37464f] px-5 pt-4">
      <div class="max-w-xl mx-auto flex justify-end">
        <button id="doneBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302]">
          ¡Entendido!
        </button>
      </div>
    </footer>`;

  bindQuit();
  app.querySelectorAll(".speak-btn").forEach((b) =>
    b.addEventListener("click", () => speak(b.dataset.tts))
  );
  document.getElementById("doneBtn").addEventListener("click", finishLesson);
}

function lessonHeaderHTML(pct) {
  return `
    <header class="shrink-0 px-4 pt-4 pb-2 flex items-center gap-3">
      <button id="quitBtn" class="text-[#52656d] hover:text-white text-2xl font-bold px-1" title="Salir">✕</button>
      <div class="flex-1 h-4 rounded-full bg-[#37464f] overflow-hidden">
        <div class="progress-fill h-full rounded-full" style="width:${pct}%;background:${session.section.color}"></div>
      </div>
      ${heartsHTML("sm")}
    </header>`;
}
function lessonMetaHTML() {
  const s = session;
  return `<div class="text-xs font-extrabold uppercase tracking-widest mb-2" style="color:${s.section.color}">
    ${esc(s.section.tag)} · ${esc(s.unit.title)} · ${s.review ? "Repaso" : esc(s.lesson.title)}
  </div>`;
}
function bindQuit() {
  document.getElementById("quitBtn").addEventListener("click", () => {
    if (confirm("¿Salir de la lección? Perderás el progreso de esta lección.")) renderDashboard();
  });
}

/* ------------------------ Lección de ejercicios -------------------------- */
function renderExercise() {
  const ex = session.exercises[session.idx];
  // La barra avanza en proporción a las respuestas CORRECTAS
  const pct = (session.correct / session.total) * 100;

  let body = "";
  if (ex.type === "select_image") {
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(ex.prompt)}</h2>
      <div class="grid grid-cols-2 gap-3">
        ${shuffle(ex.options).map((o) => `
          <button class="opt-btn img-card rounded-2xl border-2 border-[#37464f] bg-[#131f24] p-4 flex flex-col items-center gap-2"
            data-val="${esc(o.id)}">
            <span class="text-5xl">${o.image}</span>
            ${ex.hide_labels ? "" : `<span class="font-bold">${esc(o.label)}</span>`}
          </button>`).join("")}
      </div>`;
  } else if (ex.type === "listening_match") {
    const ttsOK = "speechSynthesis" in window;
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-4">${esc(ex.prompt)}</h2>
      <div class="flex justify-center mb-6">
        <button id="playBtn" class="btn3d rounded-3xl px-10 py-6 text-5xl bg-[#1cb0f6] border-[#1899d6]">🔊</button>
      </div>
      ${ttsOK ? "" : `<p class="mb-4 text-sm font-bold text-[#ff9600]">⚠️ Tu navegador no soporta audio TTS. Pista: <span class="italic">${esc(ex.tts)}</span></p>`}
      <div class="grid gap-3">
        ${shuffle(ex.options).map((o) => `
          <button class="opt-btn rounded-2xl border-2 border-[#37464f] bg-[#131f24] px-4 py-3 text-left font-bold text-base"
            data-val="${esc(o)}">${esc(o)}</button>`).join("")}
      </div>`;
  } else if (ex.type === "translate_direct") {
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(ex.prompt)}</h2>
      <textarea id="trInput" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Escribe en alemán…"
        class="answer-input w-full rounded-2xl border-2 border-[#37464f] bg-[#202f36] p-4 text-lg font-semibold resize-none"></textarea>
      <p class="mt-2 text-xs text-[#52656d] font-semibold">Consejo: puedes escribir ae, oe, ue y ss en lugar de ä, ö, ü y ß.</p>`;
  } else { // word_bank
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(ex.prompt)}</h2>
      <div id="answerArea" class="min-h-[58px] border-b-2 border-t-2 border-[#37464f] py-2 flex flex-wrap gap-2 items-center"></div>
      <div id="bankArea" class="mt-6 flex flex-wrap gap-2 justify-center"></div>`;
  }

  app.innerHTML = `
    ${lessonHeaderHTML(pct)}
    <main class="scroll-area flex-1 px-5 py-6 max-w-xl w-full mx-auto" id="qArea">
      ${lessonMetaHTML()}
      ${body}
    </main>
    <footer id="footer" class="app-footer border-t-2 border-[#37464f] px-5 pt-4">
      <div class="max-w-xl mx-auto flex justify-end">
        <button id="checkBtn" disabled
          class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302] disabled:bg-[#37464f] disabled:border-[#2b3940] disabled:text-[#52656d]">
          Comprobar
        </button>
      </div>
    </footer>`;

  bindQuit();
  const checkBtn = document.getElementById("checkBtn");
  let getAnswer = null;

  if (ex.type === "select_image" || ex.type === "listening_match") {
    let selected = null;
    app.querySelectorAll(".opt-btn").forEach((b) => {
      b.addEventListener("click", () => {
        app.querySelectorAll(".opt-btn").forEach((x) => x.classList.remove("opt-selected"));
        b.classList.add("opt-selected");
        selected = b.dataset.val;
        checkBtn.disabled = false;
      });
    });
    getAnswer = () => selected;
    if (ex.type === "listening_match") {
      const playBtn = document.getElementById("playBtn");
      playBtn.addEventListener("click", () => playExerciseAudio(ex));
      setTimeout(() => playExerciseAudio(ex), 350); // intento de autoplay
    }
  } else if (ex.type === "translate_direct") {
    const input = document.getElementById("trInput");
    input.focus();
    input.addEventListener("input", () => { checkBtn.disabled = input.value.trim() === ""; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (!checkBtn.disabled) checkBtn.click(); }
    });
    getAnswer = () => input.value;
  } else { // word_bank
    const answerArea = document.getElementById("answerArea");
    const bankArea = document.getElementById("bankArea");
    let chosen = [];
    let bank = shuffle(
      ex.words.concat(ex.distractors || []).map((word, i) => ({ word, id: i, used: false }))
    );
    function chipHTML(item) {
      return `<button class="chip-btn chip-enter rounded-xl border-2 border-[#37464f] bg-[#202f36] px-3 py-2 font-bold"
        data-id="${item.id}">${esc(item.word)}</button>`;
    }
    function redraw() {
      answerArea.innerHTML = chosen.map(chipHTML).join("");
      bankArea.innerHTML = bank.map((b) =>
        b.used
          ? `<span class="rounded-xl border-2 border-[#202f36] bg-[#202f36] px-3 py-2 font-bold text-transparent select-none">${esc(b.word)}</span>`
          : chipHTML(b)
      ).join("");
      answerArea.querySelectorAll(".chip-btn").forEach((c) =>
        c.addEventListener("click", () => {
          const id = +c.dataset.id;
          chosen = chosen.filter((x) => x.id !== id);
          bank.find((b) => b.id === id).used = false;
          redraw();
        })
      );
      bankArea.querySelectorAll(".chip-btn").forEach((c) =>
        c.addEventListener("click", () => {
          const id = +c.dataset.id;
          const item = bank.find((b) => b.id === id);
          item.used = true;
          chosen.push({ word: item.word, id });
          redraw();
        })
      );
      checkBtn.disabled = chosen.length === 0;
    }
    redraw();
    getAnswer = () => chosen.map((c) => c.word).join(" ");
  }

  checkBtn.addEventListener("click", () => {
    const userAnswer = getAnswer();
    let correct, solution;
    if (ex.type === "select_image") {
      correct = userAnswer === ex.correct;
      const opt = ex.options.find((o) => o.id === ex.correct);
      solution = `${opt.image} ${opt.label}`;
    } else if (ex.type === "listening_match") {
      correct = userAnswer === ex.answer;
      solution = ex.answer;
    } else if (ex.type === "translate_direct") {
      correct = translationMatches(userAnswer, ex);
      solution = ex.answer;
    } else {
      solution = ex.words.join(" ");
      correct = userAnswer === solution;
    }
    showFeedback(correct, solution);
  });
}

function showFeedback(correct, solution) {
  app.querySelectorAll(".opt-btn, .chip-btn").forEach((b) => (b.disabled = true));
  const input = document.getElementById("trInput");
  if (input) input.disabled = true;

  const qArea = document.getElementById("qArea");
  const ex = session.exercises[session.idx];

  if (correct) {
    session.correct++;
    sfx("ok");
    removeMistake(ex._ref); // dominado: sale del repaso de errores
    qArea.classList.add("flash-ok");
    // Avance visual inmediato de la barra (proporcional a aciertos)
    const bar = app.querySelector(".progress-fill");
    if (bar) bar.style.width = (session.correct / session.total) * 100 + "%";
  } else {
    session.wrong++;
    sfx("bad");
    addMistake(ex._ref); // a la lista de repaso
    state.hearts = Math.max(0, state.hearts - 1);
    if (!state.heartsTs) state.heartsTs = Date.now(); // arranca la regeneración
    persist();
    const hearts = document.getElementById("hearts");
    if (hearts) {
      hearts.outerHTML = heartsHTML("sm");
      document.getElementById("hearts").classList.add("heart-lost");
    }
    qArea.classList.add("shake", "flash-bad");
    // Re-encolar el ejercicio fallado al final (si la lección continúa)
    if (state.hearts > 0) session.exercises.push(ex);
  }

  const defeated = state.hearts <= 0;
  const footer = document.getElementById("footer");
  footer.className = "app-footer feedback-bar border-t-2 px-5 pt-4 " +
    (correct ? "bg-[#d7ffb8] border-[#a5ed6e]" : "bg-[#ffdfe0] border-[#ffb2b2]");
  footer.innerHTML = `
    <div class="max-w-xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
      <div class="flex-1">
        <div class="flex items-center gap-2 text-xl font-extrabold ${correct ? "text-[#58a700]" : "text-[#ea2b2b]"}">
          <span class="text-3xl pop-icon">${correct ? "✅" : "❌"}</span>
          ${correct ? "¡Muy bien!" : "Incorrecto"}
          <button id="audioBtn" title="Escuchar en alemán"
            class="btn3d rounded-xl px-3 py-1.5 text-lg bg-[#1cb0f6] border-[#1899d6] text-white">🔊</button>
        </div>
        ${correct ? "" : `<div class="mt-1 font-bold text-[#ea2b2b]">Respuesta correcta: <span class="font-extrabold">${esc(solution)}</span></div>`}
        ${ex.explain ? `<div class="mt-1.5 text-sm font-semibold ${correct ? "text-[#4a8f00]" : "text-[#b91c1c]"}">💡 ${esc(ex.explain)}</div>` : ""}
      </div>
      <button id="nextBtn"
        class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-white ${correct ? "bg-[#58cc02] border-[#46a302]" : "bg-[#ff4b4b] border-[#c93636]"}">
        ${defeated ? "Fin de la lección" : "Continuar"}
      </button>
    </div>`;

  const nextBtn = document.getElementById("nextBtn");
  nextBtn.focus();
  nextBtn.addEventListener("click", advance);
  const audioBtn = document.getElementById("audioBtn");
  if (audioBtn) audioBtn.addEventListener("click", () => playExerciseAudio(ex));
}

function advance() {
  // Sin corazones: derrota inmediata y vuelta a la selección de lección
  if (state.hearts <= 0) { renderGameOver(); return; }
  session.idx++;
  // La cola crece con los fallos re-encolados: la lección solo termina
  // cuando TODOS los ejercicios se han respondido correctamente.
  if (session.idx >= session.exercises.length) finishLesson();
  else renderExercise();
}

/* ------------------------- Minijuego: parejas ----------------------------
   Cuadrícula única con 8 botones mezclados (4 alemán + 4 español) por ronda.
   Temporizador global de 30 s. Acierto: verde y se desactivan. Fallo:
   parpadeo rojo y deselección. Éxito: bono DOBLE de XP (ver finishLesson). */
const MATCH_TIME = 30;      // segundos
const MATCH_ROUND_SIZE = 4; // parejas visibles a la vez (8 botones)

function renderMatchGame() {
  const allPairs = shuffle(session.lesson.pairs);
  const total = allPairs.length;
  let matched = 0;        // parejas acertadas en total
  let roundStart = 0;     // índice de la ronda actual
  let sel = null;         // botón seleccionado {el, lang, word}
  let timeLeft = MATCH_TIME;
  let timerId = null;
  let over = false;

  app.innerHTML = `
    ${lessonHeaderHTML(0)}
    <main class="scroll-area flex-1 px-5 py-6 max-w-xl w-full mx-auto" id="qArea">
      ${lessonMetaHTML()}
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl sm:text-2xl font-extrabold">Une las parejas 🇩🇪↔🇪🇸</h2>
        <div id="timerChip" class="rounded-2xl border-2 border-[#37464f] bg-[#202f36] px-4 py-2 font-extrabold text-lg tabular-nums">⏱️ ${MATCH_TIME}s</div>
      </div>
      <p class="text-xs text-[#52656d] font-semibold mb-5">Toca una palabra y su pareja en el otro idioma antes de que acabe el tiempo. Aquí no se pierden vidas.</p>
      <div id="gridArea" class="grid grid-cols-2 gap-3"></div>
    </main>
    <footer class="app-footer border-t-2 border-[#37464f] px-5 pt-4">
      <div class="max-w-xl mx-auto text-center text-sm font-extrabold text-[#8a9ba5]" id="matchStatus">0/${total} parejas</div>
    </footer>`;

  const bar = app.querySelector(".progress-fill");
  const status = document.getElementById("matchStatus");
  const timerChip = document.getElementById("timerChip");
  const grid = document.getElementById("gridArea");

  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  // Salir limpia el temporizador (no usamos bindQuit genérico)
  document.getElementById("quitBtn").addEventListener("click", () => {
    if (confirm("¿Salir del minijuego? Perderás el progreso de esta partida.")) {
      stopTimer();
      renderDashboard();
    }
  });

  function drawRound() {
    sel = null;
    const pairs = allPairs.slice(roundStart, roundStart + MATCH_ROUND_SIZE);
    const buttons = shuffle(
      pairs.map((p) => ({ lang: "de", word: p.de }))
        .concat(pairs.map((p) => ({ lang: "es", word: p.es })))
    );
    grid.innerHTML = buttons.map((b) => `
      <button class="match-chip chip-btn chip-enter rounded-xl border-2 border-[#37464f] bg-[#202f36] px-3 py-4 font-bold"
        data-lang="${b.lang}" data-w="${esc(b.word)}">${esc(b.word)}</button>`).join("");
    grid.querySelectorAll(".match-chip").forEach((btn) =>
      btn.addEventListener("click", () => onChipClick(btn, pairs))
    );
  }

  function onChipClick(btn, pairs) {
    if (over || btn.disabled) return;
    const lang = btn.dataset.lang, word = btn.dataset.w;

    if (sel && sel.el === btn) {                 // deseleccionar
      btn.classList.remove("opt-selected");
      sel = null;
      return;
    }
    if (!sel || sel.lang === lang) {             // primera selección o cambio
      if (sel) sel.el.classList.remove("opt-selected");
      btn.classList.add("opt-selected");
      sel = { el: btn, lang, word };
      if (lang === "de") speak(word);
      return;
    }

    // Tenemos una palabra de cada idioma: evaluar
    const de = lang === "de" ? word : sel.word;
    const es = lang === "es" ? word : sel.word;
    const ok = pairs.some((p) => p.de === de && p.es === es);
    const a = sel.el, b = btn;
    sel = null;

    if (ok) {
      session.correct++;
      matched++;
      sfx("match");
      [a, b].forEach((c) => {
        c.classList.remove("opt-selected");
        c.classList.add("match-ok");
        c.disabled = true;
      });
      bar.style.width = (matched / total) * 100 + "%";
      status.textContent = `${matched}/${total} parejas`;
      const roundDone = matched - roundStart >= Math.min(MATCH_ROUND_SIZE, total - roundStart);
      if (matched >= total) {                    // ¡victoria!
        over = true;
        stopTimer();
        setTimeout(finishLesson, 450);
      } else if (roundDone) {                    // siguiente ronda de 4 parejas
        roundStart += MATCH_ROUND_SIZE;
        setTimeout(drawRound, 450);
      }
    } else {
      session.wrong++;
      sfx("bad");
      [a, b].forEach((c) => {
        c.classList.remove("opt-selected");
        c.classList.add("match-bad");            // parpadeo rojo
        setTimeout(() => c.classList.remove("match-bad"), 650);
      });
    }
  }

  function tick() {
    timeLeft--;
    timerChip.textContent = `⏱️ ${timeLeft}s`;
    if (timeLeft <= 10) timerChip.classList.add("timer-low");
    if (timeLeft <= 0) {
      over = true;
      stopTimer();
      renderTimeUp();
    }
  }

  drawRound();
  timerId = setInterval(tick, 1000);
}

function renderTimeUp() {
  const { section, unit } = session;
  session = null;
  app.innerHTML = `
    <main class="scroll-area flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div class="pop-in text-7xl mb-4">⏰</div>
      <h1 class="text-3xl font-extrabold text-[#ff9600] mb-2">¡Tiempo agotado!</h1>
      <p class="text-[#8a9ba5] font-bold mb-8 max-w-sm">
        Se acabaron los 30 segundos. ¡A la próxima seguro que lo consigues!
      </p>
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button id="retryBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#ffc800] border-[#e6a800]">
          🔄 Reintentar
        </button>
        <button id="homeBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#8a9ba5] bg-[#131f24] border-2 border-[#37464f] border-b-[#2b3940]">
          Volver al inicio
        </button>
      </div>
    </main>`;
  document.getElementById("retryBtn").addEventListener("click", () => startLesson(section, unit));
  document.getElementById("homeBtn").addEventListener("click", renderDashboard);
}

/* ====================== LECCIÓN COMPLETADA / GAME OVER =================== */
function finishLesson() {
  if (session && session.isMistakes) { finishMistakesLesson(); return; }
  const unit = session.unit;
  const before = state.units[unit.id] || 0;
  const crownedNow = !session.review && before + 1 >= unit.lessons.length;
  if (!session.review) state.units[unit.id] = Math.min(unit.lessons.length, before + 1);

  const isGame = session.lesson.kind === "match_game";
  const isTheory = session.lesson.kind === "theory";
  // Teoría: 5 XP fijos. Minijuego completado: bono DOBLE de XP.
  const base = isTheory ? 5 : session.review ? 5 : 10 + Math.max(0, 5 - session.wrong);
  const gained = isGame ? base * 2 : base;
  addXp(gained);
  touchStreak();
  persist();

  const total = session.correct + session.wrong;
  const accuracy = total ? Math.round((session.correct / total) * 100) : 100;
  const sec = session.section;
  const doneNow = state.units[unit.id] || 0;

  app.innerHTML = `
    <main class="scroll-area flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div class="pop-in text-7xl mb-4">${crownedNow ? "👑" : "🎉"}</div>
      <h1 class="text-3xl font-extrabold mb-2" style="color:${sec.color}">
        ${crownedNow ? "¡Unidad completada!" : "¡Lección completada!"}
      </h1>
      <p class="text-[#8a9ba5] font-bold mb-2">${esc(sec.tag)} · ${esc(unit.title)} · ${esc(session.lesson.title)}</p>
      ${session.review
        ? `<p class="text-[#8a9ba5] font-bold mb-8">Repaso terminado 💪</p>`
        : `<p class="text-[#8a9ba5] font-bold mb-8">Lecciones de la unidad: ${doneNow}/${unit.lessons.length}</p>`}
      ${isGame ? `<div class="mb-4 font-extrabold text-[#1cb0f6] pop-in">🎮 ¡Bono de minijuego: XP ×2!</div>` : ""}
      <div class="flex gap-4 mb-6">
        <div class="rounded-2xl border-2 border-[#ffc800] px-6 py-4">
          <div class="text-xs font-extrabold uppercase text-[#ffc800]">XP ganados</div>
          <div class="text-2xl font-extrabold text-[#ffc800]">⚡ +${gained}</div>
        </div>
        ${isTheory ? "" : `<div class="rounded-2xl border-2 border-[#58cc02] px-6 py-4">
          <div class="text-xs font-extrabold uppercase text-[#58cc02]">Precisión</div>
          <div class="text-2xl font-extrabold text-[#58cc02]">${accuracy}%</div>
        </div>`}
      </div>
      <div class="mb-8 font-extrabold text-[#ff9600]">🔥 Racha: ${state.streak} ${state.streak === 1 ? "día" : "días"}</div>
      <button id="contBtn" class="btn3d w-full max-w-xs rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302]">
        Continuar
      </button>
    </main>`;
  document.getElementById("contBtn").addEventListener("click", renderDashboard);
  sfx(crownedNow ? "win" : "ok");
  if (crownedNow) confettiBurst();
}

/* Cierre de la lección de repaso de errores */
function finishMistakesLesson() {
  const gained = 10;
  addXp(gained);
  touchStreak();
  persist();
  const remaining = (state.mistakes || []).length;
  app.innerHTML = `
    <main class="scroll-area flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div class="pop-in text-7xl mb-4">🩹</div>
      <h1 class="text-3xl font-extrabold mb-2 text-[#ff4b4b]">¡Errores repasados!</h1>
      <p class="text-[#8a9ba5] font-bold mb-6">
        ${remaining === 0 ? "Tu lista de errores está limpia. ¡Impresionante! ✨" : `Te quedan ${remaining} por dominar. ¡Cada vez menos!`}
      </p>
      <div class="rounded-2xl border-2 border-[#ffc800] px-6 py-4 mb-8">
        <div class="text-xs font-extrabold uppercase text-[#ffc800]">XP ganados</div>
        <div class="text-2xl font-extrabold text-[#ffc800]">⚡ +${gained}</div>
      </div>
      <button id="contBtn" class="btn3d w-full max-w-xs rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302]">
        Continuar
      </button>
    </main>`;
  document.getElementById("contBtn").addEventListener("click", renderDashboard);
  sfx(remaining === 0 ? "win" : "ok");
  if (remaining === 0) confettiBurst();
}

/* Lección especial: reintentar los ejercicios fallados (hasta 10) */
async function startMistakesLesson() {
  if (state.hearts <= 0) { renderGameOver(); return; }
  const refs = (state.mistakes || []).slice(0, 10);
  if (!refs.length) { renderDashboard(); return; }
  showLoading("Preparando tu repaso…");
  const exercises = [];
  try {
    await loadManifest();
    for (const r of refs) {
      const sec = await loadSection(r.sec);
      const unit = sec.units.find((u) => u.id === r.u);
      const lesson = unit && unit.lessons[r.l - 1];
      const ex = lesson && lesson.kind === "exercises" && lesson.exercises[r.q - 1];
      if (ex) exercises.push(Object.assign({
        _qid: r.q,
        _audio: `audio/unit_${r.u}/lesson_${r.l}/q_${r.q}.mp3`,
        _ref: r,
      }, ex));
    }
  } catch (e) { showDataError(e, startMistakesLesson); return; }
  if (!exercises.length) { state.mistakes = []; persist(); renderDashboard(); return; }
  session = {
    isMistakes: true,
    section: { index: 0, color: "#ff4b4b", dark: "#c93636", tag: "Repaso" },
    unit: { id: "mistakes", title: "Tus errores", lessons: [] },
    lesson: { kind: "exercises", index: 0, title: "🩹 A la segunda va la vencida" },
    review: false, idx: 0, correct: 0, wrong: 0,
    exercises: shuffle(exercises),
    total: exercises.length,
  };
  prefetchLessonAudio();
  renderExercise();
}

function renderGameOver() {
  session = null;
  clearRegenTimer();
  sfx("bad");
  const mins = minsToNextHeart();
  app.innerHTML = `
    <main class="scroll-area flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div class="pop-in text-7xl mb-4">💔</div>
      <h1 class="text-3xl font-extrabold text-[#ff4b4b] mb-2">¡Derrota!</h1>
      <p class="text-[#8a9ba5] font-bold mb-4 max-w-sm">
        Te has quedado sin corazones y la lección ha terminado. No pasa nada:
        equivocarse es parte de aprender.
      </p>
      ${mins ? `<p class="font-extrabold text-[#ff9600] mb-6">⏳ Próximo ❤️ en ~${mins} min (se regeneran solos cada 30)</p>` : ""}
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button id="refillBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-white bg-[#ff4b4b] border-[#c93636]">
          ❤️ Recuperar 5 vidas ya
        </button>
        <button id="homeBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#8a9ba5] bg-[#131f24] border-2 border-[#37464f] border-b-[#2b3940]">
          Volver al inicio
        </button>
      </div>
    </main>`;
  document.getElementById("refillBtn").addEventListener("click", () => {
    state.hearts = MAX_HEARTS;
    state.heartsTs = null;
    persist();
    renderDashboard();
  });
  document.getElementById("homeBtn").addEventListener("click", renderDashboard);
  // Si se regenera un corazón mientras espera, volver al árbol automáticamente
  regenTimer = setInterval(() => {
    if (applyHeartRegen()) { persist(); renderDashboard(); }
  }, 10000);
}

/* ================================ INICIO ================================= */
renderProfileSelect();
