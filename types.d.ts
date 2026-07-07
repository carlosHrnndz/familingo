/* ============================================================================
   Familingo — Esquema estricto del contenido (contrato de datos)
   ----------------------------------------------------------------------------
   Este archivo es DOCUMENTACIÓN del formato de los JSON en /data.
   La app es JS vanilla y no lo compila, pero todo archivo de sección
   DEBE cumplir estas interfaces. Jerarquía:

     SectionFile -> Section -> Unit[] -> Lesson[] -> Exercise[]
   ========================================================================== */

/** Archivo data/manifest.json: índice ligero de secciones (se carga primero). */
export interface Manifest {
  schema_version: 1;
  app: string;
  sections: SectionMeta[];
}

export interface SectionMeta {
  id: string;          // "s1"
  index: number;       // 1..4 (orden global)
  tag: string;         // "A1" | "A2" | "B1" | "B2"
  title: string;       // "Principiante"
  color: string;       // color principal (hex)
  dark: string;        // color del borde 3D (hex)
  file: string;        // "section_1.json" (relativo a /data)
  units_total: number; // unidades declaradas en el archivo
  ready_units: number; // unidades con contenido jugable (el resto, cascarones)
}

/** Archivo data/section_N.json */
export interface SectionFile {
  schema_version: 1;
  section: Section;
}

export interface Section {
  id: string;
  index: number;
  tag: string;
  title: string;
  color: string;
  dark: string;
  units: Unit[];
}

export interface Unit {
  id: string;                        // "s1_u1" (clave de progreso en la nube)
  index: number;                     // 1..N dentro de la sección
  title: string;                     // "Primeros Pasos"
  icon: string;                      // emoji del nodo
  status: "ready" | "coming_soon";   // cascarón => "coming_soon" + lessons: []
  lessons: Lesson[];                 // exactamente 5 si status === "ready"
}

export type Lesson = ExerciseLesson | MatchGameLesson;

interface LessonBase {
  id: string;       // "s1_u1_l1"
  index: number;    // 1..5 (columna current_lesson de la BD)
  title: string;
}

/** Lección estándar: secuencia de ejercicios. */
export interface ExerciseLesson extends LessonBase {
  kind: "exercises";
  exercises: Exercise[];
}

/** Lección minijuego: emparejar alemán <-> español. */
export interface MatchGameLesson extends LessonBase {
  kind: "match_game";
  pairs: { de: string; es: string }[];
}

/* ------------------------- Tipos de ejercicio --------------------------- */
export type Exercise =
  | SelectImageExercise
  | WordBankExercise
  | TranslateDirectExercise
  | ListeningMatchExercise;

/** Elegir la imagen correcta (imágenes = emoji, sin assets binarios). */
export interface SelectImageExercise {
  type: "select_image";
  prompt: string;                                        // "Selecciona: «el perro»"
  options: { id: string; image: string; label: string }[]; // label en alemán
  correct: string;                                       // id de la opción correcta
}

/** Banco de palabras: construir la frase pulsando fichas. */
export interface WordBankExercise {
  type: "word_bank";
  prompt: string;          // "Traduce: «Tengo un perro»"
  words: string[];         // EN ORDEN CORRECTO (la app las baraja)
  distractors?: string[];  // palabras trampa opcionales
}

/** Traducción escrita libre. */
export interface TranslateDirectExercise {
  type: "translate_direct";
  prompt: string;
  answer: string;          // respuesta canónica
  accepted?: string[];     // variantes aceptadas (normalización aparte)
}

/** Escuchar (TTS de-DE del navegador) y elegir lo que se oye. */
export interface ListeningMatchExercise {
  type: "listening_match";
  prompt: string;          // "Escucha y elige lo que oyes"
  tts: string;             // texto que se sintetiza en alemán
  options: string[];       // incluye la respuesta
  answer: string;
}
