# Prompt optimizado para generar los audios (LLM o Google TTS)

## Cómo obtener el listado plano

```bash
node tools/generate_audio.mjs --list          # ver por pantalla
node tools/generate_audio.mjs --tsv frases.tsv # guardar en archivo
```

Formato de salida (una línea por audio, separador tabulador):

```
audio/unit_s1_u1/lesson_1/q_1.mp3	Hallo
audio/unit_s1_u1/lesson_1/q_2.mp3	Gute Nacht
audio/unit_s1_u1/lesson_1/q_3.mp3	Hallo wie geht es dir
...
```

## Vía directa (recomendada): API de Google Cloud Text-to-Speech

```bash
GOOGLE_TTS_API_KEY=TU_CLAVE node tools/generate_audio.mjs --synth
```

Genera todos los MP3 que falten en `/audio` con la estructura exacta que espera
la app (`audio/unit_[id]/lesson_[id]/q_[n].mp3`). Voz por defecto
`de-DE-Neural2-F` (femenina, neural, muy natural); alternativas:
`de-DE-Neural2-D` (masculina), `de-DE-Wavenet-F`. Velocidad 0.92 para
claridad didáctica. Luego sube la carpeta `audio/` al repositorio.

## Prompt para un modelo de lenguaje / herramienta TTS por lotes

Copia lo siguiente y pega debajo el listado plano generado arriba:

---

Eres un locutor nativo de alemán estándar (Hochdeutsch) grabando material
didáctico para niños hispanohablantes que aprenden alemán (niveles A1-B2).

Recibirás una lista de líneas con el formato `ruta<TAB>frase`. Para CADA línea
debes sintetizar un archivo de audio MP3 con estas reglas estrictas:

1. **Voz**: alemana nativa, neutra (Hochdeutsch), femenina, cálida y clara.
   Sin acento extranjero, sin dialecto regional.
2. **Fonética limpia**: pronuncia con precisión las vocales con Umlaut
   (ä, ö, ü), la ß como /s/ larga, la "ch" en sus dos variantes (ich-Laut y
   ach-Laut), y las terminaciones -en y -er sin comérselas.
3. **Ritmo didáctico**: velocidad ~90 % de la conversación natural, con
   entonación natural (no robótica ni silabeada). En preguntas, entonación
   ascendente real del alemán.
4. **Sin añadidos**: no leas la ruta, no numeres, no añadas saludos ni pausas
   largas. Solo la frase, con ~200 ms de silencio inicial y final.
5. **Nombre del archivo**: exactamente la ruta indicada en su línea.
6. Si una frase contiene un nombre propio español (Ana, Marta…), pronúncialo
   suave pero integrado en la fonética alemana.

Lista de frases:
[PEGAR AQUÍ LA SALIDA DE generate_audio.mjs --list]

---

## Notas

- La app funciona sin los MP3: si un archivo no existe, cae automáticamente
  al sintetizador de voz del navegador (de-DE). Los audios grabados solo
  mejoran la calidad.
- El script es incremental: no regenera archivos ya existentes.
- Al añadir nuevas unidades a los JSON, vuelve a ejecutar `--synth` y solo
  se crearán los audios nuevos.
