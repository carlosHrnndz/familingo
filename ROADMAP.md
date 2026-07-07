# 🦉 Familingo — Roadmap y Biblia del Proyecto

> Documento de referencia único. Toda decisión de producto y de arquitectura
> se registra aquí. Última actualización: julio 2026.

---

## 1. Estado actual (v3)

### Qué es
Clon familiar de Duolingo para aprender alemán (ES→DE), desplegado en GitHub
Pages (`carloshrnndz.github.io/familingo`), sin backend propio: HTML + Tailwind
CDN + JS vanilla + Supabase (progreso en la nube, tiempo real).

### Arquitectura
```
index.html            Shell (100dvh, layout móvil)
styles.css            Animaciones y estados (acierto/error, minijuego, timer)
script.js             Motor: dashboard, 4 tipos de ejercicio, minijuego,
                      vidas, rachas, XP, Supabase realtime
supabase-config.js    Credenciales (URL + anon key)
setup.sql             Esquema de la tabla user_progress
types.d.ts            Contrato TypeScript del contenido
data/manifest.json    Índice de secciones (carga inicial ligera)
data/section_1..4.json  Contenido por sección (fetch bajo demanda + caché)
tools/generate_audio.mjs  Extractor de frases + síntesis Google TTS
tools/tts_prompt.md   Prompt optimizado para generar audios
```

### Contenido
| Sección | Estado |
|---|---|
| A1 (s1) | ✅ **Completa**: 10 unidades, 50 lecciones, 232 ejercicios, 60 parejas |
| A2 (s2) | 🚧 14 cascarones |
| B1 (s3) | 🚧 14 cascarones |
| B2 (s4) | 🚧 14 cascarones |

### Mecánicas ya operativas
4 perfiles con sync multidispositivo en tiempo real · 5 vidas con derrota ·
barra de progreso por aciertos con re-encolado de fallos · rachas diarias ·
XP con bono ×2 en minijuego · minijuego de parejas con timer 30 s ·
audio MP3 con fallback TTS · desbloqueo secuencial de unidades y secciones.

---

## 2. Problemas conocidos (deuda técnica y de diseño)

| # | Problema | Gravedad | Causa raíz |
|---|---|---|---|
| P1 | `select_image` se auto-delata: el emoji 8️⃣ o el círculo 🔴 revelan la respuesta sin saber alemán | 🔴 Alta | El "prompt ES + imagen + etiqueta DE" solo funciona cuando la imagen no codifica el significado pedido (números y colores lo codifican) |
| P2 | El altavoz de la corrección no suena en móvil | 🔴 Alta | Sin MP3 aún, el fallback TTS se dispara en el callback `onerror` (asíncrono), fuera del "gesto de usuario" que iOS/Android exigen |
| P3 | Todo es evaluación: no hay fase de enseñanza antes de los tests | 🔴 Alta | No existe el tipo de lección "teoría" en el esquema |
| P4 | Sin explicación pedagógica al corregir (por qué es correcto/incorrecto) | 🟠 Media | El esquema no tiene campo `explain` |
| P5 | El autoplay del ejercicio de escucha no suena en móvil la primera vez | 🟡 Baja | Mismo motivo que P2 (sin gesto de usuario) |
| P6 | La restricción SQL `current_lesson between 1 and 5` bloquea unidades de 6 lecciones | 🟡 Baja | CHECK demasiado estricto en `setup.sql` |
| P7 | Sin audios MP3 reales (todo depende del TTS del navegador, calidad variable) | 🟠 Media | Falta ejecutar `generate_audio.mjs --synth` con clave de Google |
| P8 | El progreso se puede perder si dos dispositivos escriben a la vez (last-write-wins simple) | 🟡 Baja | Sin merge de estados; aceptable para uso familiar |

---

## 3. Roadmap

### 🎯 FASE 1 — Calidad pedagógica (la prioridad ahora)

**1.1 Lecciones de teoría** `[P3]`
- Nuevo `kind: "theory"` en el esquema: bloques `heading | text | vocab | example | tip`.
  Las tablas `vocab` y los `example` llevan audio (🔊 por fila).
- Sin corazones ni comprobación: se lee, se escucha y botón "¡Entendido!".
- Estructura de unidad objetivo: **L1 teoría → L2-L4 práctica → L5 minijuego**
  (se mantienen 5 lecciones por unidad → no rompe la BD ni el progreso).
- Reetiquetar en la UI: L1 "📖 Aprende", L2-4 "✏️ Practica", L5 "🎮 Juega".

**1.2 Explicaciones en las correcciones** `[P4]`
- Campo opcional `explain` (string) en cada ejercicio.
- La barra de feedback lo muestra siempre: en verde ("✅ Correcto: *möchte*
  va en 2ª posición…") y en rojo con la corrección.
- Pase de contenido: escribir `explain` para los 232 ejercicios de A1.

**1.3 Arreglar `select_image` delator** `[P1]`
- Auditoría de los ejercicios donde la imagen codifica la respuesta
  (números, colores) y sustitución por una de estas variantes:
  a) Prompt en alemán + imágenes SIN etiqueta («Selecciona: *acht*»).
  b) Convertir a `listening_match` o `translate_direct`.
- Regla de estilo para contenido futuro: *la imagen nunca puede responder
  por sí sola a la pregunta*.

**1.4 Audio fiable en móvil** `[P2, P5, P7]`
- Reordenar el fallback: dentro del click, comprobar si el MP3 existe
  (HEAD precacheado al cargar la lección); si no, llamar a `speak()`
  síncronamente en el propio gesto.
- "Desbloqueo" de TTS en iOS: primer toque del usuario dispara un utterance
  vacío para inicializar el sintetizador.
- Generar los MP3 reales de A1 (`--synth`) y subir `/audio` → el problema
  desaparece de raíz.

### 🚀 FASE 2 — Experiencia de juego

**2.1 Regeneración de vidas por tiempo**: +1 corazón cada 30 min
(timestamp en la nube), en lugar de solo el botón de rellenar.
**2.2 Repaso inteligente de errores**: guardar los ejercicios fallados por
usuario (`mistakes` en el jsonb) y ofrecer una lección "🩹 Repasa tus errores".
**2.3 Sonidos reales**: ding/error/fanfarria con WebAudio (sin archivos).
**2.4 Confeti** al coronar unidad y al récord de racha.
**2.5 Liga familiar**: tabla semanal de XP de los 4 perfiles (los datos ya
están en Supabase; es una consulta y una pantalla).
**2.6 Objetivo diario** configurable (p. ej. 20 XP/día) con anillo de progreso.

### 📚 FASE 3 — Contenido A2 (siguiendo la regla 1.3 y con `explain` desde el inicio)
- 14 unidades A2 en `section_2.json`, por tandas de 3-4 unidades.
- Nuevos tipos de ejercicio para variar: `cloze` (rellenar hueco con opciones)
  y `translate_reverse` (DE→ES).
- Ajustar `setup.sql`: CHECK de `current_unit` a 1-14 y `current_lesson` a 1-6
  (migración con `alter table`) `[P6]`.

### 📱 FASE 4 — Plataforma
**4.1 PWA**: manifest + service worker → instalable en el móvil de los niños
con icono propio, y contenido/audios cacheados offline (el progreso ya tiene
modo local).
**4.2 CI de contenido**: GitHub Action que ejecuta el validador de esquema en
cada push (evita subir un JSON roto).
**4.3 Exportar/importar progreso** (JSON) como copia de seguridad.

### 🔮 FASE 5 — Ideas futuras (sin compromiso)
- Ejercicio de habla con `SpeechRecognition` (Chrome): "di la frase en alemán".
- Historias cortas interactivas (estilo Duolingo Stories) al final de sección.
- Avatares desbloqueables con XP.
- Modo contrarreloj global ("Lightning Round") con ranking familiar.

---

## 4. Reglas de oro del proyecto

1. **Cero build, cero dependencias**: HTML + Tailwind CDN + JS vanilla + Supabase. Nada que compile.
2. **El contenido vive en `/data`**, el código no se toca para añadir unidades.
3. Toda unidad `ready` tiene exactamente **5 lecciones** (hasta la migración de Fase 3).
4. **La imagen nunca responde la pregunta** (regla anti-P1).
5. Todo ejercicio nuevo lleva **`explain`** desde su creación.
6. Antes de subir contenido: pasar el **validador** (`node` script / CI).
7. La app debe funcionar **sin MP3 y sin conexión** (fallbacks TTS y localStorage).
8. Los niños son los usuarios: textos amables, sin castigos frustrantes.

---

## 5. Orden de ejecución propuesto

| Sprint | Entregable |
|---|---|
| 1 | Fase 1 completa (teoría + explain + fix select_image + audio móvil) sobre las unidades 1-2 como piloto |
| 2 | Extender Fase 1 a las unidades 3-10 de A1 + generar MP3 |
| 3 | Fase 2 (vidas por tiempo, repaso de errores, sonidos, liga familiar) |
| 4+ | Fase 3 en tandas + Fase 4 |
