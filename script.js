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
const USERS = [
  { name: "Antón",  icon: "🦁", color: "#58cc02" },
  { name: "Pepa",   icon: "🦄", color: "#ff86d0" },
  { name: "Lázaro", icon: "🦊", color: "#ff9600" },
  { name: "Carlos", icon: "🐻", color: "#1cb0f6" },
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
  return { hearts: MAX_HEARTS, xp: 0, streak: 0, lastActive: null, units: {} };
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

function touchStreak() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastActive === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  state.streak = state.lastActive === yesterday ? state.streak + 1 : 1;
  state.lastActive = today;
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
      progress: { units: state.units },
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
function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
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
          <span class="font-extrabold text-[#ff9600]">🔥 ${state.streak}</span>
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

      <section class="mt-8 flex flex-col items-center">${nodes}</section>

      <div class="mt-10 text-center">
        <button id="resetBtn" class="text-xs font-bold text-[#52656d] underline">Reiniciar el progreso de ${esc(currentUser.name)}</button>
      </div>
    </main>`;

  document.getElementById("userChip").addEventListener("click", renderProfileSelect);
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

/* ============================== LECCIÓN ================================== */
function startLesson(section, unit) {
  if (state.hearts <= 0) { renderGameOver(); return; }
  const done = lessonsDoneId(unit.id);
  const review = done >= unit.lessons.length;
  const lesson = unit.lessons[review ? Math.floor(Math.random() * unit.lessons.length) : done];
  session = {
    section, unit, lesson, review,
    idx: 0, correct: 0, wrong: 0,
    exercises: lesson.kind === "exercises" ? shuffle(lesson.exercises) : null,
  };
  if (lesson.kind === "match_game") renderMatchGame();
  else renderExercise();
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
  const total = session.exercises.length;
  const pct = (session.idx / total) * 100;

  let body = "";
  if (ex.type === "select_image") {
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(ex.prompt)}</h2>
      <div class="grid grid-cols-2 gap-3">
        ${shuffle(ex.options).map((o) => `
          <button class="opt-btn img-card rounded-2xl border-2 border-[#37464f] bg-[#131f24] p-4 flex flex-col items-center gap-2"
            data-val="${esc(o.id)}">
            <span class="text-5xl">${o.image}</span>
            <span class="font-bold">${esc(o.label)}</span>
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
      playBtn.addEventListener("click", () => speak(ex.tts));
      setTimeout(() => speak(ex.tts), 350); // intento de autoplay (si el SO lo permite)
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

  if (correct) {
    session.correct++;
  } else {
    session.wrong++;
    state.hearts = Math.max(0, state.hearts - 1);
    persist();
    const hearts = document.getElementById("hearts");
    if (hearts) {
      hearts.outerHTML = heartsHTML("sm");
      document.getElementById("hearts").classList.add("heart-lost");
    }
    document.getElementById("qArea").classList.add("shake");
  }

  const footer = document.getElementById("footer");
  footer.className = "app-footer feedback-bar border-t-2 px-5 pt-4 " +
    (correct ? "bg-[#d7ffb8] border-[#a5ed6e]" : "bg-[#ffdfe0] border-[#ffb2b2]");
  footer.innerHTML = `
    <div class="max-w-xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
      <div class="flex-1">
        <div class="flex items-center gap-2 text-xl font-extrabold ${correct ? "text-[#58a700]" : "text-[#ea2b2b]"}">
          <span class="text-2xl">${correct ? "✅" : "❌"}</span>
          ${correct ? "¡Muy bien!" : "Incorrecto"}
        </div>
        ${correct ? "" : `<div class="mt-1 font-bold text-[#ea2b2b]">Respuesta correcta: <span class="font-extrabold">${esc(solution)}</span></div>`}
      </div>
      <button id="nextBtn"
        class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-white ${correct ? "bg-[#58cc02] border-[#46a302]" : "bg-[#ff4b4b] border-[#c93636]"}">
        Continuar
      </button>
    </div>`;

  const nextBtn = document.getElementById("nextBtn");
  nextBtn.focus();
  nextBtn.addEventListener("click", advance);
}

function advance() {
  if (state.hearts <= 0) { renderGameOver(); return; }
  session.idx++;
  if (session.idx >= session.exercises.length) finishLesson();
  else renderExercise();
}

/* ------------------------- Minijuego: parejas ---------------------------- */
function renderMatchGame() {
  const pairs = session.lesson.pairs;
  const total = pairs.length;
  let matched = 0;
  let selDe = null, selEs = null;

  const deList = shuffle(pairs.map((p) => p.de));
  const esList = shuffle(pairs.map((p) => p.es));

  app.innerHTML = `
    ${lessonHeaderHTML(0)}
    <main class="scroll-area flex-1 px-5 py-6 max-w-xl w-full mx-auto" id="qArea">
      ${lessonMetaHTML()}
      <h2 class="text-xl sm:text-2xl font-extrabold mb-2">Une las parejas 🇩🇪 → 🇪🇸</h2>
      <p class="text-xs text-[#52656d] font-semibold mb-6">En este minijuego no se pierden vidas. ¡Tú puedes!</p>
      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-3">
          ${deList.map((w) => `<button class="match-chip chip-btn rounded-xl border-2 border-[#37464f] bg-[#202f36] px-3 py-3 font-bold" data-lang="de" data-w="${esc(w)}">${esc(w)}</button>`).join("")}
        </div>
        <div class="flex flex-col gap-3">
          ${esList.map((w) => `<button class="match-chip chip-btn rounded-xl border-2 border-[#37464f] bg-[#202f36] px-3 py-3 font-bold" data-lang="es" data-w="${esc(w)}">${esc(w)}</button>`).join("")}
        </div>
      </div>
    </main>
    <footer class="app-footer border-t-2 border-[#37464f] px-5 pt-4">
      <div class="max-w-xl mx-auto text-center text-sm font-extrabold text-[#8a9ba5]" id="matchStatus">0/${total} parejas</div>
    </footer>`;

  bindQuit();
  const bar = app.querySelector(".progress-fill");
  const status = document.getElementById("matchStatus");

  function clearSel(lang) {
    app.querySelectorAll(`.match-chip[data-lang="${lang}"]`).forEach((c) => c.classList.remove("opt-selected"));
  }
  function tryMatch() {
    if (!selDe || !selEs) return;
    const de = selDe.dataset.w, es = selEs.dataset.w;
    const ok = pairs.some((p) => p.de === de && p.es === es);
    const a = selDe, b = selEs;
    selDe = null; selEs = null;
    if (ok) {
      session.correct++;
      matched++;
      [a, b].forEach((c) => {
        c.classList.remove("opt-selected");
        c.classList.add("match-ok");
        c.disabled = true;
      });
      bar.style.width = (matched / total) * 100 + "%";
      status.textContent = `${matched}/${total} parejas`;
      if (matched === total) setTimeout(finishLesson, 450);
    } else {
      session.wrong++;
      [a, b].forEach((c) => {
        c.classList.remove("opt-selected");
        c.classList.add("match-bad");
        setTimeout(() => c.classList.remove("match-bad"), 450);
      });
    }
  }
  app.querySelectorAll(".match-chip").forEach((c) =>
    c.addEventListener("click", () => {
      const lang = c.dataset.lang;
      clearSel(lang);
      c.classList.add("opt-selected");
      if (lang === "de") { selDe = c; speak(c.dataset.w); } else { selEs = c; }
      tryMatch();
    })
  );
}

/* ====================== LECCIÓN COMPLETADA / GAME OVER =================== */
function finishLesson() {
  const unit = session.unit;
  const before = state.units[unit.id] || 0;
  const crownedNow = !session.review && before + 1 >= unit.lessons.length;
  if (!session.review) state.units[unit.id] = Math.min(unit.lessons.length, before + 1);

  const isGame = session.lesson.kind === "match_game";
  const gained = session.review ? 5
    : isGame ? 10 + (session.wrong === 0 ? 5 : 0)
    : 10 + Math.max(0, 5 - session.wrong);
  state.xp += gained;
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
      <div class="flex gap-4 mb-6">
        <div class="rounded-2xl border-2 border-[#ffc800] px-6 py-4">
          <div class="text-xs font-extrabold uppercase text-[#ffc800]">XP ganados</div>
          <div class="text-2xl font-extrabold text-[#ffc800]">⚡ +${gained}</div>
        </div>
        <div class="rounded-2xl border-2 border-[#58cc02] px-6 py-4">
          <div class="text-xs font-extrabold uppercase text-[#58cc02]">Precisión</div>
          <div class="text-2xl font-extrabold text-[#58cc02]">${accuracy}%</div>
        </div>
      </div>
      <div class="mb-8 font-extrabold text-[#ff9600]">🔥 Racha: ${state.streak} ${state.streak === 1 ? "día" : "días"}</div>
      <button id="contBtn" class="btn3d w-full max-w-xs rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302]">
        Continuar
      </button>
    </main>`;
  document.getElementById("contBtn").addEventListener("click", renderDashboard);
}

function renderGameOver() {
  session = null;
  app.innerHTML = `
    <main class="scroll-area flex-1 flex flex-col items-center justify-center px-6 py-8 text-center">
      <div class="pop-in text-7xl mb-4">💔</div>
      <h1 class="text-3xl font-extrabold text-[#ff4b4b] mb-2">¡Te has quedado sin vidas!</h1>
      <p class="text-[#8a9ba5] font-bold mb-8 max-w-sm">
        No pasa nada: equivocarse es parte de aprender. Recupera tus vidas y vuelve a intentarlo.
      </p>
      <div class="flex flex-col gap-3 w-full max-w-xs">
        <button id="refillBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-white bg-[#ff4b4b] border-[#c93636]">
          ❤️ Recuperar 5 vidas
        </button>
        <button id="homeBtn" class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#8a9ba5] bg-[#131f24] border-2 border-[#37464f] border-b-[#2b3940]">
          Volver al inicio
        </button>
      </div>
    </main>`;
  document.getElementById("refillBtn").addEventListener("click", () => {
    state.hearts = MAX_HEARTS;
    persist();
    renderDashboard();
  });
  document.getElementById("homeBtn").addEventListener("click", renderDashboard);
}

/* ================================ INICIO ================================= */
renderProfileSelect();
