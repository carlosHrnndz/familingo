#!/usr/bin/env node
/* ============================================================================
   Familingo — Extractor de frases y generador de audio (Google Cloud TTS)
   ----------------------------------------------------------------------------
   Recorre TODOS los data/section_N.json, extrae secuencialmente cada frase
   alemana de cada ejercicio y la asocia a su ruta de audio canónica:

       audio/unit_[unit.id]/lesson_[lesson.index]/q_[n].mp3

   (la misma ruta que reproduce la app; n = posición del ejercicio en el JSON)

   USO (requiere Node 18+):
     node tools/generate_audio.mjs --list
         Imprime el listado plano "ruta<TAB>frase" (para revisar o para
         pegarlo en un LLM junto con tools/tts_prompt.md).

     node tools/generate_audio.mjs --tsv audio_manifest.tsv
         Guarda el listado en un TSV.

     GOOGLE_TTS_API_KEY=xxxx node tools/generate_audio.mjs --synth
         Sintetiza los MP3 que falten llamando a la API de Google Cloud
         Text-to-Speech y los deja en /audio con la estructura correcta.
         Voz por defecto: de-DE-Neural2-F (cámbiala con --voice NOMBRE).
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const AUDIO_DIR = path.join(ROOT, "audio");

/* --------- Limpieza para una fonética natural en el sintetizador ---------
   - fuera comillas tipográficas y marcadores («», „", …)
   - espacios normalizados; se conservan ä ö ü ß y la puntuación real,
     que el TTS usa para la entonación. */
function cleanForTTS(s) {
  return String(s)
    .replace(/[«»„“”‚’"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Texto alemán canónico de cada ejercicio (mismo criterio que la app)
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

/* ------------------------- Extracción secuencial ------------------------- */
function extractRows() {
  const rows = [];
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => /^section_\d+\.json$/.test(f))
    .sort();
  for (const file of files) {
    const { section } = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    for (const unit of section.units) {
      if (unit.status !== "ready") continue; // los cascarones no tienen frases aún
      for (const lesson of unit.lessons) {
        if (lesson.kind !== "exercises") continue; // el minijuego usa TTS en vivo
        lesson.exercises.forEach((ex, i) => {
          const text = cleanForTTS(germanTextFor(ex));
          if (!text) return;
          rows.push({
            file: `audio/unit_${unit.id}/lesson_${lesson.index}/q_${i + 1}.mp3`,
            text,
          });
        });
      }
    }
  }
  return rows;
}

/* --------------------- Síntesis con Google Cloud TTS --------------------- */
async function synthesize(rows, voice) {
  const KEY = process.env.GOOGLE_TTS_API_KEY;
  if (!KEY) {
    console.error("Falta la variable de entorno GOOGLE_TTS_API_KEY.");
    console.error("Créala en Google Cloud Console (API Text-to-Speech activada).");
    process.exit(1);
  }
  const URL = "https://texttospeech.googleapis.com/v1/text:synthesize?key=" + KEY;
  let done = 0, skipped = 0;
  for (const row of rows) {
    const outPath = path.join(ROOT, row.file);
    if (fs.existsSync(outPath)) { skipped++; continue; } // no regenerar
    const body = {
      input: { text: row.text },
      voice: { languageCode: "de-DE", name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.92, pitch: 0 },
    };
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`ERROR ${res.status} en "${row.text}":`, await res.text());
      process.exit(1);
    }
    const { audioContent } = await res.json();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(audioContent, "base64"));
    done++;
    console.log(`✔ ${row.file}  <- "${row.text}"`);
  }
  console.log(`\nSíntesis completa: ${done} generados, ${skipped} ya existían.`);
  console.log(`Carpeta de salida: ${AUDIO_DIR}`);
}

/* --------------------------------- CLI ----------------------------------- */
const args = process.argv.slice(2);
const rows = extractRows();

if (args.includes("--synth")) {
  const vi = args.indexOf("--voice");
  const voice = vi !== -1 ? args[vi + 1] : "de-DE-Neural2-F";
  await synthesize(rows, voice);
} else if (args.includes("--tsv")) {
  const out = args[args.indexOf("--tsv") + 1] || "audio_manifest.tsv";
  fs.writeFileSync(out, rows.map((r) => r.file + "\t" + r.text).join("\n") + "\n");
  console.log(`${rows.length} frases -> ${out}`);
} else {
  // --list (por defecto): formato plano ruta<TAB>frase
  for (const r of rows) console.log(r.file + "\t" + r.text);
  console.error(`\n[${rows.length} frases extraídas]`);
}
