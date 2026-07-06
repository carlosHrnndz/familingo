"use strict";
/* ============================================================================
   DeutschLernen — Clon de Duolingo para aprender alemán (ES -> DE)
   HTML5 + Tailwind (CDN) + JavaScript Vanilla. Sin backend.
   Progreso, XP y vidas persisten en localStorage.
   ============================================================================

   TIPOS DE PREGUNTA:
   - { t:'mc', q, a, opts }   -> opción múltiple (a = respuesta correcta,
                                 opts = 3 distractores; se barajan al mostrar)
   - { t:'tr', q, a, acc }    -> traducción escrita (acc = variantes aceptadas)
   - { t:'or', q, w }         -> ordenar palabras con botones (w = orden correcto)
   ========================================================================== */

/* ============================== CURRICULUM =============================== */
const CURRICULUM = [
  {
    id: "a1",
    name: "Principiante",
    tag: "A1",
    color: "#58cc02",
    dark: "#46a302",
    units: [
      { name: "Saludos", icon: "👋", questions: [
        { t: "mc", q: "¿Qué significa «Guten Morgen»?", a: "Buenos días (por la mañana)", opts: ["Buenas noches", "Hasta luego", "Bienvenido"] },
        { t: "tr", q: "Traduce al alemán: «Buenas noches»", a: "Gute Nacht", acc: ["gute nacht"] },
        { t: "or", q: "Ordena: «Hola, ¿cómo estás?»", w: ["Hallo", "wie", "geht", "es", "dir"] },
        { t: "mc", q: "«Auf Wiedersehen» significa…", a: "Adiós (formal)", opts: ["Buenos días", "Por favor", "Gracias"] },
      ]},
      { name: "Presentaciones", icon: "🙋", questions: [
        { t: "tr", q: "Traduce: «Me llamo Ana»", a: "Ich heiße Ana", acc: ["ich heisse ana"] },
        { t: "or", q: "Ordena: «Yo vengo de España»", w: ["Ich", "komme", "aus", "Spanien"] },
        { t: "mc", q: "¿Cómo se pregunta «¿De dónde vienes?»?", a: "Woher kommst du?", opts: ["Wie alt bist du?", "Wo wohnst du?", "Was machst du?"] },
        { t: "tr", q: "Traduce: «Yo tengo diez años»", a: "Ich bin zehn Jahre alt", acc: ["ich bin 10 jahre alt"] },
      ]},
      { name: "Números", icon: "🔢", questions: [
        { t: "mc", q: "¿Cómo se dice el número 7?", a: "sieben", opts: ["sechs", "acht", "neun"] },
        { t: "tr", q: "Traduce el número: «veinte»", a: "zwanzig", acc: [] },
        { t: "mc", q: "«dreißig» es el número…", a: "30", opts: ["13", "3", "33"] },
        { t: "or", q: "Ordena: «Yo tengo dos hermanos»", w: ["Ich", "habe", "zwei", "Brüder"] },
      ]},
      { name: "Familia", icon: "👨‍👩‍👧", questions: [
        { t: "mc", q: "«die Schwester» significa…", a: "la hermana", opts: ["la madre", "la tía", "la abuela"] },
        { t: "tr", q: "Traduce con artículo: «el padre»", a: "der Vater", acc: ["vater"] },
        { t: "or", q: "Ordena: «Mi madre se llama Marta»", w: ["Meine", "Mutter", "heißt", "Marta"] },
        { t: "mc", q: "¿Cómo se dice «los abuelos»?", a: "die Großeltern", opts: ["die Eltern", "die Geschwister", "die Kinder"] },
      ]},
      { name: "Comida y bebida", icon: "🍞", questions: [
        { t: "mc", q: "«das Brot» significa…", a: "el pan", opts: ["la leche", "el queso", "la carne"] },
        { t: "tr", q: "Traduce con artículo: «el agua»", a: "das Wasser", acc: ["wasser"] },
        { t: "or", q: "Ordena: «Quiero un café, por favor»", w: ["Ich", "möchte", "einen", "Kaffee", "bitte"] },
        { t: "mc", q: "«der Apfel» significa…", a: "la manzana", opts: ["la naranja", "el plátano", "la pera"] },
      ]},
      { name: "Colores", icon: "🎨", questions: [
        { t: "mc", q: "«rot» es el color…", a: "rojo", opts: ["verde", "amarillo", "negro"] },
        { t: "tr", q: "Traduce el color: «verde»", a: "grün", acc: ["gruen"] },
        { t: "mc", q: "Completa: «Der Himmel ist ___» (El cielo es azul)", a: "blau", opts: ["braun", "grau", "gelb"] },
        { t: "or", q: "Ordena: «El coche es negro»", w: ["Das", "Auto", "ist", "schwarz"] },
      ]},
      { name: "Días y meses", icon: "📅", questions: [
        { t: "mc", q: "«Mittwoch» es el día…", a: "miércoles", opts: ["lunes", "jueves", "domingo"] },
        { t: "tr", q: "Traduce el día: «lunes»", a: "Montag", acc: [] },
        { t: "or", q: "Ordena: «Hoy es viernes»", w: ["Heute", "ist", "Freitag"] },
        { t: "mc", q: "¿Qué mes es «Juli»?", a: "julio", opts: ["junio", "enero", "mayo"] },
      ]},
      { name: "La casa", icon: "🏠", questions: [
        { t: "mc", q: "«die Küche» significa…", a: "la cocina", opts: ["el baño", "el salón", "el jardín"] },
        { t: "tr", q: "Traduce con artículo: «el dormitorio»", a: "das Schlafzimmer", acc: ["schlafzimmer"] },
        { t: "or", q: "Ordena: «La casa es grande»", w: ["Das", "Haus", "ist", "groß"] },
        { t: "mc", q: "«der Tisch» significa…", a: "la mesa", opts: ["la silla", "la cama", "la puerta"] },
      ]},
      { name: "Animales", icon: "🐶", questions: [
        { t: "mc", q: "«der Hund» significa…", a: "el perro", opts: ["el gato", "el ratón", "el pájaro"] },
        { t: "tr", q: "Traduce con artículo: «el gato»", a: "die Katze", acc: ["katze"] },
        { t: "or", q: "Ordena: «El pájaro canta»", w: ["Der", "Vogel", "singt"] },
        { t: "mc", q: "«das Pferd» significa…", a: "el caballo", opts: ["la vaca", "el cerdo", "la oveja"] },
      ]},
      { name: "Verbos básicos", icon: "⚡", questions: [
        { t: "mc", q: "Completa con «sein»: «ich ___»", a: "bin", opts: ["bist", "ist", "sind"] },
        { t: "tr", q: "Traduce: «nosotros somos»", a: "wir sind", acc: [] },
        { t: "or", q: "Ordena: «Ella tiene un libro»", w: ["Sie", "hat", "ein", "Buch"] },
        { t: "mc", q: "«gehen» significa…", a: "ir / caminar", opts: ["comer", "dormir", "hablar"] },
      ]},
    ],
  },
  {
    id: "a2",
    name: "Elemental",
    tag: "A2",
    color: "#1cb0f6",
    dark: "#1899d6",
    units: [
      { name: "Rutina diaria", icon: "⏰", questions: [
        { t: "or", q: "Ordena: «Me levanto a las siete»", w: ["Ich", "stehe", "um", "sieben", "Uhr", "auf"] },
        { t: "mc", q: "«aufstehen» significa…", a: "levantarse", opts: ["acostarse", "ducharse", "vestirse"] },
        { t: "tr", q: "Traduce: «Yo desayuno»", a: "Ich frühstücke", acc: ["ich fruehstuecke"] },
        { t: "mc", q: "Verbo separable: «Ich ___ jeden Tag früh ___» (aufstehen)", a: "stehe … auf", opts: ["aufstehe … –", "stehe … an", "gehe … auf"] },
      ]},
      { name: "Compras", icon: "🛒", questions: [
        { t: "mc", q: "«Wie viel kostet das?» significa…", a: "¿Cuánto cuesta esto?", opts: ["¿Qué hora es?", "¿Dónde está la caja?", "¿Tiene cambio?"] },
        { t: "tr", q: "Traduce: «demasiado caro»", a: "zu teuer", acc: [] },
        { t: "or", q: "Ordena: «Quisiera pagar con tarjeta»", w: ["Ich", "möchte", "mit", "Karte", "zahlen"] },
        { t: "mc", q: "«das Geschäft» significa…", a: "la tienda", opts: ["el mercado", "el precio", "el dinero"] },
      ]},
      { name: "En la ciudad", icon: "🏙️", questions: [
        { t: "mc", q: "«das Rathaus» significa…", a: "el ayuntamiento", opts: ["el hospital", "la biblioteca", "el museo"] },
        { t: "or", q: "Ordena: «¿Dónde está la estación?»", w: ["Wo", "ist", "der", "Bahnhof"] },
        { t: "tr", q: "Traduce la indicación: «a la derecha»", a: "rechts", acc: ["nach rechts"] },
        { t: "mc", q: "«geradeaus» significa…", a: "todo recto", opts: ["a la izquierda", "detrás", "cerca"] },
      ]},
      { name: "Transporte", icon: "🚆", questions: [
        { t: "mc", q: "«der Zug» significa…", a: "el tren", opts: ["el avión", "el barco", "el tranvía"] },
        { t: "tr", q: "Traduce con artículo: «el autobús»", a: "der Bus", acc: ["bus"] },
        { t: "or", q: "Ordena: «Voy en bici al colegio»", w: ["Ich", "fahre", "mit", "dem", "Rad", "zur", "Schule"] },
        { t: "mc", q: "«umsteigen» significa…", a: "hacer transbordo", opts: ["subir", "bajar", "conducir"] },
      ]},
      { name: "El tiempo", icon: "🌦️", questions: [
        { t: "mc", q: "«Es regnet» significa…", a: "Está lloviendo", opts: ["Está nevando", "Hace sol", "Hace frío"] },
        { t: "tr", q: "Traduce: «Hace sol»", a: "Es ist sonnig", acc: ["die sonne scheint"] },
        { t: "or", q: "Ordena: «Mañana va a nevar»", w: ["Morgen", "wird", "es", "schneien"] },
        { t: "mc", q: "«der Wind» significa…", a: "el viento", opts: ["la nube", "la tormenta", "la niebla"] },
      ]},
      { name: "Salud y cuerpo", icon: "🩺", questions: [
        { t: "mc", q: "«der Kopf» significa…", a: "la cabeza", opts: ["el brazo", "la pierna", "la mano"] },
        { t: "tr", q: "Traduce: «Me duele la tripa»", a: "Mein Bauch tut weh", acc: ["ich habe bauchschmerzen"] },
        { t: "or", q: "Ordena: «Necesito un médico»", w: ["Ich", "brauche", "einen", "Arzt"] },
        { t: "mc", q: "«die Erkältung» significa…", a: "el resfriado", opts: ["la fiebre", "la tos", "la gripe"] },
      ]},
      { name: "Ropa", icon: "👕", questions: [
        { t: "mc", q: "«die Hose» significa…", a: "los pantalones", opts: ["la falda", "el abrigo", "los zapatos"] },
        { t: "tr", q: "Traduce con artículo: «la camiseta»", a: "das T-Shirt", acc: ["t-shirt", "das tshirt", "tshirt"] },
        { t: "or", q: "Ordena: «El vestido es muy bonito»", w: ["Das", "Kleid", "ist", "sehr", "schön"] },
        { t: "mc", q: "«anprobieren» significa…", a: "probarse (ropa)", opts: ["comprar", "devolver", "lavar"] },
      ]},
      { name: "Aficiones", icon: "⚽", questions: [
        { t: "mc", q: "«schwimmen» significa…", a: "nadar", opts: ["correr", "saltar", "bailar"] },
        { t: "tr", q: "Traduce: «Yo toco la guitarra»", a: "Ich spiele Gitarre", acc: [] },
        { t: "or", q: "Ordena: «Nos gusta jugar al fútbol»", w: ["Wir", "spielen", "gern", "Fußball"] },
        { t: "mc", q: "«lesen» significa…", a: "leer", opts: ["escribir", "dibujar", "cantar"] },
      ]},
      { name: "Pasado (Perfekt)", icon: "🕰️", questions: [
        { t: "mc", q: "Completa: «Ich ___ Pizza gegessen»", a: "habe", opts: ["bin", "hat", "bist"] },
        { t: "or", q: "Ordena: «He visto una película»", w: ["Ich", "habe", "einen", "Film", "gesehen"] },
        { t: "tr", q: "Escribe el participio (Partizip II) de «machen»", a: "gemacht", acc: [] },
        { t: "mc", q: "Completa: «Wir ___ nach Berlin gefahren»", a: "sind", opts: ["haben", "seid", "hat"] },
      ]},
      { name: "En el restaurante", icon: "🍽️", questions: [
        { t: "mc", q: "«die Speisekarte» significa…", a: "la carta / el menú", opts: ["la cuenta", "la propina", "la mesa"] },
        { t: "or", q: "Ordena: «La cuenta, por favor»", w: ["Die", "Rechnung", "bitte"] },
        { t: "tr", q: "Traduce: «Quisiera reservar una mesa»", a: "Ich möchte einen Tisch reservieren", acc: ["ich moechte einen tisch reservieren"] },
        { t: "mc", q: "«lecker» significa…", a: "delicioso / rico", opts: ["salado", "amargo", "caliente"] },
      ]},
    ],
  },
  {
    id: "b1",
    name: "Intermedio Bajo",
    tag: "B1",
    color: "#ce82ff",
    dark: "#a568cc",
    units: [
      { name: "Viajes", icon: "✈️", questions: [
        { t: "mc", q: "«der Flughafen» significa…", a: "el aeropuerto", opts: ["la estación", "el puerto", "la frontera"] },
        { t: "or", q: "Ordena: «Hemos reservado un hotel en Múnich»", w: ["Wir", "haben", "ein", "Hotel", "in", "München", "gebucht"] },
        { t: "tr", q: "Traduce con artículo: «el pasaporte»", a: "der Reisepass", acc: ["reisepass", "der pass"] },
        { t: "mc", q: "«die Unterkunft» significa…", a: "el alojamiento", opts: ["el equipaje", "el billete", "la excursión"] },
      ]},
      { name: "Trabajo", icon: "💼", questions: [
        { t: "mc", q: "«die Bewerbung» significa…", a: "la solicitud de empleo", opts: ["el sueldo", "el despido", "el contrato"] },
        { t: "tr", q: "Traduce: «la entrevista de trabajo»", a: "das Vorstellungsgespräch", acc: ["vorstellungsgespraech", "vorstellungsgespräch"] },
        { t: "or", q: "Ordena: «Ella trabaja como ingeniera»", w: ["Sie", "arbeitet", "als", "Ingenieurin"] },
        { t: "mc", q: "«der Lebenslauf» significa…", a: "el currículum", opts: ["la nómina", "la oficina", "el horario"] },
      ]},
      { name: "Educación", icon: "🎓", questions: [
        { t: "mc", q: "«die Prüfung» significa…", a: "el examen", opts: ["la nota", "el curso", "la beca"] },
        { t: "or", q: "Ordena: «Tengo que estudiar para el examen»", w: ["Ich", "muss", "für", "die", "Prüfung", "lernen"] },
        { t: "tr", q: "Traduce con artículo: «la universidad»", a: "die Universität", acc: ["universitaet", "universität", "die uni"] },
        { t: "mc", q: "«bestehen» (una prueba) significa…", a: "aprobar", opts: ["suspender", "repetir", "copiar"] },
      ]},
      { name: "Tecnología", icon: "💻", questions: [
        { t: "mc", q: "«herunterladen» significa…", a: "descargar", opts: ["subir", "borrar", "guardar"] },
        { t: "tr", q: "Traduce con artículo: «la pantalla»", a: "der Bildschirm", acc: ["bildschirm"] },
        { t: "or", q: "Ordena: «Mi ordenador no funciona»", w: ["Mein", "Computer", "funktioniert", "nicht"] },
        { t: "mc", q: "«die Datei» significa…", a: "el archivo", opts: ["la carpeta", "la red", "la impresora"] },
      ]},
      { name: "Sentimientos", icon: "💜", questions: [
        { t: "mc", q: "«stolz» significa…", a: "orgulloso", opts: ["triste", "celoso", "asustado"] },
        { t: "tr", q: "Traduce: «Estoy preocupado»", a: "Ich bin besorgt", acc: ["ich mache mir sorgen"] },
        { t: "or", q: "Ordena: «Me alegro de verte»", w: ["Ich", "freue", "mich", "dich", "zu", "sehen"] },
        { t: "mc", q: "«enttäuscht» significa…", a: "decepcionado", opts: ["emocionado", "aburrido", "sorprendido"] },
      ]},
      { name: "Präteritum", icon: "📜", questions: [
        { t: "mc", q: "Präteritum de «gehen»: «ich ___»", a: "ging", opts: ["gehte", "gegangen", "gang"] },
        { t: "or", q: "Ordena: «Él era muy amable»", w: ["Er", "war", "sehr", "nett"] },
        { t: "tr", q: "Escribe el Präteritum de «haben» con «er»", a: "hatte", acc: ["er hatte"] },
        { t: "mc", q: "«Sie konnte nicht kommen» significa…", a: "Ella no pudo venir", opts: ["Ella no quiere venir", "Ella no debe venir", "Ella no vendrá"] },
      ]},
      { name: "Konjunktiv II", icon: "🌠", questions: [
        { t: "mc", q: "Completa: «Ich ___ gern nach Japan reisen»", a: "würde", opts: ["werde", "wurde", "will"] },
        { t: "or", q: "Ordena: «Si tuviera tiempo, te ayudaría»", w: ["Wenn", "ich", "Zeit", "hätte", "würde", "ich", "dir", "helfen"] },
        { t: "tr", q: "Traduce: «yo sería» (Konjunktiv II de sein)", a: "ich wäre", acc: ["ich waere", "waere", "wäre"] },
        { t: "mc", q: "«Könntest du mir helfen?» significa…", a: "¿Podrías ayudarme?", opts: ["¿Puedes oírme?", "¿Quieres ayudarme?", "¿Me ayudaste?"] },
      ]},
      { name: "Medio ambiente", icon: "🌍", questions: [
        { t: "mc", q: "«die Umwelt» significa…", a: "el medio ambiente", opts: ["el clima", "la basura", "la energía"] },
        { t: "tr", q: "Traduce el verbo: «reciclar»", a: "recyceln", acc: [] },
        { t: "or", q: "Ordena: «Debemos proteger la naturaleza»", w: ["Wir", "müssen", "die", "Natur", "schützen"] },
        { t: "mc", q: "«der Klimawandel» significa…", a: "el cambio climático", opts: ["la contaminación", "el calentamiento", "la sequía"] },
      ]},
      { name: "Relaciones", icon: "🤝", questions: [
        { t: "mc", q: "«sich verlieben» significa…", a: "enamorarse", opts: ["casarse", "separarse", "conocerse"] },
        { t: "tr", q: "Traduce con artículo: «la amistad»", a: "die Freundschaft", acc: ["freundschaft"] },
        { t: "or", q: "Ordena: «Nos conocimos hace dos años»", w: ["Wir", "haben", "uns", "vor", "zwei", "Jahren", "kennengelernt"] },
        { t: "mc", q: "«sich streiten» significa…", a: "pelearse / discutir", opts: ["abrazarse", "reírse", "ayudarse"] },
      ]},
      { name: "Subordinadas", icon: "🔗", questions: [
        { t: "mc", q: "Completa: «Ich weiß, dass du recht ___»", a: "hast", opts: ["habst", "hat", "haben"] },
        { t: "or", q: "Ordena: «Creo que el alemán es interesante»", w: ["Ich", "denke", "dass", "Deutsch", "interessant", "ist"] },
        { t: "mc", q: "La conjunción «weil» significa…", a: "porque", opts: ["aunque", "cuando", "mientras"] },
        { t: "tr", q: "Traduce la conjunción: «aunque»", a: "obwohl", acc: [] },
      ]},
    ],
  },
  {
    id: "b2",
    name: "Intermedio",
    tag: "B2",
    color: "#ff9600",
    dark: "#cc7800",
    units: [
      { name: "Política y sociedad", icon: "🏛️", questions: [
        { t: "mc", q: "«die Wahl» significa…", a: "la elección / las elecciones", opts: ["la ley", "el partido", "el voto obligatorio"] },
        { t: "tr", q: "Traduce con artículo: «el gobierno»", a: "die Regierung", acc: ["regierung"] },
        { t: "or", q: "Ordena: «El parlamento aprueba la ley»", w: ["Das", "Parlament", "verabschiedet", "das", "Gesetz"] },
        { t: "mc", q: "«der Bürger» significa…", a: "el ciudadano", opts: ["el alcalde", "el diputado", "el juez"] },
      ]},
      { name: "Economía", icon: "📈", questions: [
        { t: "mc", q: "«die Wirtschaft» significa…", a: "la economía", opts: ["la empresa", "la bolsa", "la industria"] },
        { t: "tr", q: "Traduce con artículo: «el desempleo»", a: "die Arbeitslosigkeit", acc: ["arbeitslosigkeit"] },
        { t: "or", q: "Ordena: «La empresa aumenta sus beneficios»", w: ["Das", "Unternehmen", "steigert", "seinen", "Gewinn"] },
        { t: "mc", q: "«die Steuer» significa…", a: "el impuesto", opts: ["el sueldo", "la deuda", "el ahorro"] },
      ]},
      { name: "Ciencia", icon: "🔬", questions: [
        { t: "mc", q: "«die Forschung» significa…", a: "la investigación", opts: ["el laboratorio", "el experimento", "la teoría"] },
        { t: "tr", q: "Traduce con artículo: «el descubrimiento»", a: "die Entdeckung", acc: ["entdeckung"] },
        { t: "or", q: "Ordena: «Los científicos desarrollan una vacuna»", w: ["Die", "Wissenschaftler", "entwickeln", "einen", "Impfstoff"] },
        { t: "mc", q: "«die Erkenntnis» significa…", a: "el hallazgo / conocimiento", opts: ["la duda", "la hipótesis", "la prueba"] },
      ]},
      { name: "Cultura y arte", icon: "🎭", questions: [
        { t: "mc", q: "«das Gemälde» significa…", a: "el cuadro / la pintura", opts: ["la escultura", "el dibujo", "la fotografía"] },
        { t: "tr", q: "Traduce: «la obra de teatro»", a: "das Theaterstück", acc: ["theaterstueck", "theaterstück"] },
        { t: "or", q: "Ordena: «La exposición me impresionó mucho»", w: ["Die", "Ausstellung", "hat", "mich", "sehr", "beeindruckt"] },
        { t: "mc", q: "«der Schriftsteller» significa…", a: "el escritor", opts: ["el pintor", "el actor", "el editor"] },
      ]},
      { name: "Voz pasiva", icon: "🔄", questions: [
        { t: "mc", q: "Completa la pasiva: «Das Haus ___ 1950 gebaut»", a: "wurde", opts: ["würde", "hat", "ist"] },
        { t: "or", q: "Ordena: «El pan es horneado por el panadero»", w: ["Das", "Brot", "wird", "vom", "Bäcker", "gebacken"] },
        { t: "mc", q: "Pasiva en Perfekt: «Die Rechnung ist bezahlt ___»", a: "worden", opts: ["geworden", "werden", "wurde"] },
        { t: "tr", q: "Traduce en pasiva: «La carta fue enviada»", a: "Der Brief wurde geschickt", acc: ["der brief wurde gesendet", "der brief wurde verschickt"] },
      ]},
      { name: "Lenguaje formal", icon: "🖋️", questions: [
        { t: "mc", q: "«eine Entscheidung treffen» significa…", a: "tomar una decisión", opts: ["cambiar de opinión", "hacer una pregunta", "dar un discurso"] },
        { t: "or", q: "Ordena (formal): «Le agradezco su ayuda»", w: ["Ich", "danke", "Ihnen", "für", "Ihre", "Hilfe"] },
        { t: "mc", q: "«in Bezug auf» significa…", a: "con respecto a", opts: ["a pesar de", "en lugar de", "a causa de"] },
        { t: "tr", q: "Saludo de carta formal: «Estimadas señoras y señores»", a: "Sehr geehrte Damen und Herren", acc: [] },
      ]},
      { name: "Modismos", icon: "🗣️", questions: [
        { t: "mc", q: "«jemandem die Daumen drücken» significa…", a: "desear suerte a alguien", opts: ["dar la mano", "hacer cosquillas", "presionar a alguien"] },
        { t: "mc", q: "«Das ist mir Wurst» significa…", a: "Me da igual", opts: ["Tengo hambre", "Es una tontería", "Está riquísimo"] },
        { t: "or", q: "Ordena: «Eso me pone de los nervios»", w: ["Das", "geht", "mir", "auf", "die", "Nerven"] },
        { t: "mc", q: "«ins Fettnäpfchen treten» significa…", a: "meter la pata", opts: ["mancharse de grasa", "tener éxito", "tropezar"] },
      ]},
      { name: "Argumentación", icon: "⚖️", questions: [
        { t: "mc", q: "«einerseits … andererseits» significa…", a: "por un lado… por otro lado", opts: ["antes… después", "ni… ni", "o bien… o bien"] },
        { t: "or", q: "Ordena: «En mi opinión, eso no es correcto»", w: ["Meiner", "Meinung", "nach", "ist", "das", "nicht", "richtig"] },
        { t: "mc", q: "«Ich bin davon überzeugt» significa…", a: "Estoy convencido de ello", opts: ["Estoy harto de ello", "Lo dudo mucho", "Me sorprende"] },
        { t: "tr", q: "Traduce el conector: «por lo tanto»", a: "deshalb", acc: ["daher", "deswegen"] },
      ]},
      { name: "Genitivo", icon: "🧩", questions: [
        { t: "mc", q: "Completa: «trotz ___ Regens» (a pesar de la lluvia)", a: "des", opts: ["dem", "der", "den"] },
        { t: "or", q: "Ordena: «El coche de mi padre es nuevo»", w: ["Das", "Auto", "meines", "Vaters", "ist", "neu"] },
        { t: "mc", q: "La preposición «während» rige…", a: "genitivo", opts: ["acusativo", "dativo", "nominativo"] },
        { t: "tr", q: "Traduce: «a pesar del mal tiempo»", a: "trotz des schlechten Wetters", acc: [] },
      ]},
      { name: "Discurso indirecto", icon: "💬", questions: [
        { t: "mc", q: "Konjunktiv I: «Er sagt, er ___ krank»", a: "sei", opts: ["ist", "wäre", "sein"] },
        { t: "or", q: "Ordena: «Ella dice que no tiene tiempo»", w: ["Sie", "sagt", "sie", "habe", "keine", "Zeit"] },
        { t: "mc", q: "El Konjunktiv I se usa principalmente para…", a: "el discurso indirecto", opts: ["las órdenes", "los deseos irreales", "el futuro"] },
        { t: "tr", q: "Escribe el Konjunktiv I de «haben» con «er»", a: "habe", acc: ["er habe"] },
      ]},
    ],
  },
];

/* =============================== ESTADO ================================= */
const STORAGE_KEY = "deutschlernen_state_v1";
const MAX_HEARTS = 5;

function defaultState() {
  return { hearts: MAX_HEARTS, xp: 0, completed: {} }; // completed: {"0-0": true}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    return {
      hearts: typeof s.hearts === "number" ? Math.max(0, Math.min(MAX_HEARTS, s.hearts)) : MAX_HEARTS,
      xp: typeof s.xp === "number" ? s.xp : 0,
      completed: s.completed && typeof s.completed === "object" ? s.completed : {},
    };
  } catch (e) {
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ====================== DESBLOQUEO SECUENCIAL ============================ */
function unitKey(l, u) { return l + "-" + u; }
function isCompleted(l, u) { return !!state.completed[unitKey(l, u)]; }

// Lista aplanada de unidades en orden global
const FLAT_UNITS = [];
CURRICULUM.forEach((lvl, l) => lvl.units.forEach((_, u) => FLAT_UNITS.push([l, u])));

function flatIndexOf(l, u) {
  return FLAT_UNITS.findIndex(([a, b]) => a === l && b === u);
}

function isUnlocked(l, u) {
  const idx = flatIndexOf(l, u);
  if (idx === 0) return true;
  const [pl, pu] = FLAT_UNITS[idx - 1];
  return isCompleted(pl, pu);
}

function isLevelUnlocked(l) {
  return isUnlocked(l, 0);
}

function levelProgress(l) {
  const total = CURRICULUM[l].units.length;
  let done = 0;
  for (let u = 0; u < total; u++) if (isCompleted(l, u)) done++;
  return { done, total };
}

/* ============================ UTILIDADES ================================ */
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

// Normaliza texto para comparar traducciones escritas.
// Genera dos formas: base (ä->a) y expandida (ä->ae) para aceptar
// respuestas con o sin diéresis.
function normForms(s) {
  let t = String(s).toLowerCase().trim()
    .replace(/ß/g, "ss")
    .replace(/[.,!?¿¡;:'"„“”‚’()]/g, "")
    .replace(/\s+/g, " ");
  const expanded = t.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
  const base = t.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
  return [t, expanded, base];
}

function translationMatches(input, question) {
  const candidates = [question.a].concat(question.acc || []);
  const inputForms = normForms(input);
  return candidates.some((c) => {
    const candForms = normForms(c);
    return inputForms.some((f) => candForms.includes(f));
  });
}

function heartsHTML(size) {
  const cls = size === "sm" ? "text-lg" : "text-2xl";
  let out = "";
  for (let i = 0; i < MAX_HEARTS; i++) {
    out += `<span class="${cls} ${i < state.hearts ? "" : "opacity-25 grayscale"}">❤️</span>`;
  }
  return `<span id="hearts" class="flex items-center gap-0.5">${out}</span>`;
}

/* ============================ DASHBOARD ================================= */
let activeLevel = 0;

// Al abrir, situarse en el primer nivel con unidades pendientes
(function initActiveLevel() {
  for (let l = 0; l < CURRICULUM.length; l++) {
    const p = levelProgress(l);
    if (p.done < p.total) { activeLevel = l; return; }
  }
  activeLevel = CURRICULUM.length - 1;
})();

function renderDashboard() {
  const lvl = CURRICULUM[activeLevel];
  const prog = levelProgress(activeLevel);
  const offsets = [0, -70, -110, -70, 0, 70, 110, 70];

  const tabs = CURRICULUM.map((L, l) => {
    const locked = !isLevelUnlocked(l);
    const active = l === activeLevel;
    return `<button data-level="${l}" class="tab-btn btn3d flex-1 py-2 px-1 rounded-2xl font-extrabold text-sm border-2
      ${active ? "text-white" : "text-[#8a9ba5] bg-[#131f24] border-[#37464f] border-b-[#37464f]"}"
      style="${active ? `background:${L.color};border-color:${L.dark};` : ""}">
      ${locked ? "🔒 " : ""}${L.tag}
    </button>`;
  }).join("");

  const nodes = lvl.units.map((unit, u) => {
    const completed = isCompleted(activeLevel, u);
    const unlocked = isUnlocked(activeLevel, u);
    const isNext = unlocked && !completed;
    const off = offsets[u % offsets.length];

    let circleStyle, inner, extraCls = "";
    if (completed) {
      circleStyle = `background:#ffc800;border-color:#e6a800;`;
      inner = "👑";
    } else if (isNext) {
      circleStyle = `background:${lvl.color};border-color:${lvl.dark};`;
      inner = unit.icon;
      extraCls = "node-active";
    } else {
      circleStyle = `background:#37464f;border-color:#2b3940;`;
      inner = "🔒";
      extraCls = "node-locked";
    }

    return `
      <div class="flex flex-col items-center" style="transform:translateX(${off}px)">
        ${isNext ? `<div class="pop-in mb-1 text-xs font-extrabold uppercase tracking-wide px-3 py-1 rounded-xl border-2 border-[#37464f] bg-[#131f24]" style="color:${lvl.color}">Empezar</div>` : ""}
        <button data-l="${activeLevel}" data-u="${u}"
          class="node-btn ${extraCls} w-[74px] h-[74px] rounded-full border-b-8 border-2 flex items-center justify-center text-3xl"
          style="${circleStyle}" ${unlocked ? "" : "disabled"}>
          ${inner}
        </button>
        <div class="mt-1 text-xs font-bold ${unlocked ? "text-white" : "text-[#52656d]"} text-center w-28">${esc(unit.name)}</div>
      </div>`;
  }).join('<div class="h-5"></div>');

  app.innerHTML = `
    <header class="sticky top-0 z-10 bg-[#131f24]/95 backdrop-blur border-b-2 border-[#37464f] px-4 py-3">
      <div class="flex items-center justify-between">
        <div class="text-2xl font-extrabold" style="color:#58cc02">🦉 DeutschLernen</div>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-1 font-extrabold text-[#ffc800]">⚡ ${state.xp} XP</div>
          ${heartsHTML("sm")}
        </div>
      </div>
      <div class="flex gap-2 mt-3">${tabs}</div>
    </header>

    <main class="flex-1 px-4 pb-16">
      <section class="mt-4 rounded-2xl p-4 border-2" style="background:${lvl.color}18;border-color:${lvl.color}55">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-extrabold uppercase tracking-widest" style="color:${lvl.color}">Nivel ${lvl.tag}</div>
            <div class="text-xl font-extrabold">${esc(lvl.name)}</div>
          </div>
          <div class="text-sm font-bold text-[#8a9ba5]">${prog.done}/${prog.total} unidades</div>
        </div>
        <div class="mt-3 h-3 rounded-full bg-[#37464f] overflow-hidden">
          <div class="progress-fill h-full rounded-full" style="width:${(prog.done / prog.total) * 100}%;background:${lvl.color}"></div>
        </div>
        ${!isLevelUnlocked(activeLevel) ? `<div class="mt-3 text-sm font-bold text-[#ff9600]">🔒 Completa el nivel anterior para desbloquear estas unidades.</div>` : ""}
      </section>

      <section class="mt-8 flex flex-col items-center">${nodes}</section>

      <div class="mt-10 text-center">
        <button id="resetBtn" class="text-xs font-bold text-[#52656d] underline">Reiniciar todo el progreso</button>
      </div>
    </main>`;

  app.querySelectorAll(".tab-btn").forEach((b) =>
    b.addEventListener("click", () => { activeLevel = +b.dataset.level; renderDashboard(); })
  );
  app.querySelectorAll(".node-btn:not([disabled])").forEach((b) =>
    b.addEventListener("click", () => startLesson(+b.dataset.l, +b.dataset.u))
  );
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("¿Seguro que quieres borrar todo el progreso, el XP y las vidas?")) {
      state = defaultState();
      saveState();
      activeLevel = 0;
      renderDashboard();
    }
  });
}

/* ============================== LECCIÓN ================================= */
let session = null;

function startLesson(l, u) {
  if (state.hearts <= 0) { renderGameOver(); return; }
  session = {
    l, u,
    queue: shuffle(CURRICULUM[l].units[u].questions),
    idx: 0,
    correct: 0,
    wrong: 0,
    review: isCompleted(l, u),
  };
  renderQuestion();
}

function renderQuestion() {
  const q = session.queue[session.idx];
  const lvl = CURRICULUM[session.l];
  const total = session.queue.length;
  const pct = (session.idx / total) * 100;

  let body = "";
  if (q.t === "mc") {
    const options = shuffle([q.a].concat(q.opts));
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(q.q)}</h2>
      <div class="grid gap-3">
        ${options.map((o) => `
          <button class="opt-btn rounded-2xl border-2 border-[#37464f] bg-[#131f24] px-4 py-3 text-left font-bold text-base"
            data-val="${esc(o)}">${esc(o)}</button>`).join("")}
      </div>`;
  } else if (q.t === "tr") {
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(q.q)}</h2>
      <textarea id="trInput" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Escribe en alemán…"
        class="answer-input w-full rounded-2xl border-2 border-[#37464f] bg-[#202f36] p-4 text-lg font-semibold resize-none"></textarea>
      <p class="mt-2 text-xs text-[#52656d] font-semibold">Consejo: puedes escribir ae, oe, ue y ss en lugar de ä, ö, ü y ß.</p>`;
  } else { // 'or'
    body = `
      <h2 class="text-xl sm:text-2xl font-extrabold mb-6">${esc(q.q)}</h2>
      <div id="answerArea" class="min-h-[58px] border-b-2 border-t-2 border-[#37464f] py-2 flex flex-wrap gap-2 items-center"></div>
      <div id="bankArea" class="mt-6 flex flex-wrap gap-2 justify-center"></div>`;
  }

  app.innerHTML = `
    <header class="px-4 pt-4 pb-2 flex items-center gap-3">
      <button id="quitBtn" class="text-[#52656d] hover:text-white text-2xl font-bold px-1" title="Salir">✕</button>
      <div class="flex-1 h-4 rounded-full bg-[#37464f] overflow-hidden">
        <div class="progress-fill h-full rounded-full" style="width:${pct}%;background:${lvl.color}"></div>
      </div>
      ${heartsHTML("sm")}
    </header>

    <main class="flex-1 px-5 py-6 max-w-xl w-full mx-auto" id="qArea">
      <div class="text-xs font-extrabold uppercase tracking-widest mb-2" style="color:${lvl.color}">
        ${esc(lvl.tag)} · ${esc(CURRICULUM[session.l].units[session.u].name)}${session.review ? " · Repaso" : ""}
      </div>
      ${body}
    </main>

    <footer id="footer" class="border-t-2 border-[#37464f] px-5 py-4">
      <div class="max-w-xl mx-auto flex justify-end">
        <button id="checkBtn" disabled
          class="btn3d rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302] disabled:bg-[#37464f] disabled:border-[#2b3940] disabled:text-[#52656d]">
          Comprobar
        </button>
      </div>
    </footer>`;

  const checkBtn = document.getElementById("checkBtn");
  document.getElementById("quitBtn").addEventListener("click", () => {
    if (confirm("¿Salir de la lección? Perderás el progreso de esta lección.")) renderDashboard();
  });

  // --- Interacciones por tipo ---
  let getAnswer = null;

  if (q.t === "mc") {
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

  } else if (q.t === "tr") {
    const input = document.getElementById("trInput");
    input.focus();
    input.addEventListener("input", () => { checkBtn.disabled = input.value.trim() === ""; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (!checkBtn.disabled) checkBtn.click(); }
    });
    getAnswer = () => input.value;

  } else { // 'or'
    const answerArea = document.getElementById("answerArea");
    const bankArea = document.getElementById("bankArea");
    let chosen = []; // [{word, id}]
    let bank = shuffle(q.w.map((word, i) => ({ word, id: i, used: false })));

    function chipHTML(item, zone) {
      return `<button class="chip-btn chip-enter rounded-xl border-2 border-[#37464f] bg-[#202f36] px-3 py-2 font-bold"
        data-id="${item.id}" data-zone="${zone}">${esc(item.word)}</button>`;
    }
    function redraw() {
      answerArea.innerHTML = chosen.map((c) => chipHTML(c, "ans")).join("");
      bankArea.innerHTML = bank.map((b) =>
        b.used
          ? `<span class="rounded-xl border-2 border-[#202f36] bg-[#202f36] px-3 py-2 font-bold text-transparent select-none">${esc(b.word)}</span>`
          : chipHTML(b, "bank")
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
      checkBtn.disabled = chosen.length !== q.w.length;
    }
    redraw();
    getAnswer = () => chosen.map((c) => c.word).join(" ");
  }

  checkBtn.addEventListener("click", () => {
    const userAnswer = getAnswer();
    let correct, solution;
    if (q.t === "mc") {
      correct = userAnswer === q.a;
      solution = q.a;
    } else if (q.t === "tr") {
      correct = translationMatches(userAnswer, q);
      solution = q.a;
    } else {
      solution = q.w.join(" ");
      correct = userAnswer === solution;
    }
    showFeedback(correct, solution);
  });
}

function showFeedback(correct, solution) {
  // Bloquear entradas
  app.querySelectorAll(".opt-btn, .chip-btn").forEach((b) => (b.disabled = true));
  const input = document.getElementById("trInput");
  if (input) input.disabled = true;

  if (correct) {
    session.correct++;
  } else {
    session.wrong++;
    state.hearts = Math.max(0, state.hearts - 1);
    saveState();
    const hearts = document.getElementById("hearts");
    if (hearts) {
      hearts.outerHTML = heartsHTML("sm");
      document.getElementById("hearts").classList.add("heart-lost");
    }
    document.getElementById("qArea").classList.add("shake");
  }

  const footer = document.getElementById("footer");
  footer.className = "feedback-bar border-t-2 px-5 py-4 " +
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
  if (session.idx >= session.queue.length) {
    finishLesson();
  } else {
    renderQuestion();
  }
}

/* ====================== LECCIÓN COMPLETADA / GAME OVER =================== */
function finishLesson() {
  const gained = session.review ? 5 : 10 + Math.max(0, 5 - session.wrong);
  state.xp += gained;
  state.completed[unitKey(session.l, session.u)] = true;
  saveState();

  const total = session.correct + session.wrong;
  const accuracy = total ? Math.round((session.correct / total) * 100) : 100;
  const lvl = CURRICULUM[session.l];

  app.innerHTML = `
    <main class="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div class="pop-in text-7xl mb-4">🎉</div>
      <h1 class="text-3xl font-extrabold mb-2" style="color:${lvl.color}">¡Lección completada!</h1>
      <p class="text-[#8a9ba5] font-bold mb-8">${esc(lvl.tag)} · ${esc(lvl.units[session.u].name)}</p>
      <div class="flex gap-4 mb-10">
        <div class="rounded-2xl border-2 border-[#ffc800] px-6 py-4">
          <div class="text-xs font-extrabold uppercase text-[#ffc800]">XP ganados</div>
          <div class="text-2xl font-extrabold text-[#ffc800]">⚡ +${gained}</div>
        </div>
        <div class="rounded-2xl border-2 border-[#58cc02] px-6 py-4">
          <div class="text-xs font-extrabold uppercase text-[#58cc02]">Precisión</div>
          <div class="text-2xl font-extrabold text-[#58cc02]">${accuracy}%</div>
        </div>
      </div>
      <button id="contBtn" class="btn3d w-full max-w-xs rounded-2xl px-8 py-3 font-extrabold uppercase text-[#131f24] bg-[#58cc02] border-[#46a302]">
        Continuar
      </button>
    </main>`;
  document.getElementById("contBtn").addEventListener("click", renderDashboard);
}

function renderGameOver() {
  app.innerHTML = `
    <main class="flex-1 flex flex-col items-center justify-center px-6 text-center">
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
    saveState();
    renderDashboard();
  });
  document.getElementById("homeBtn").addEventListener("click", renderDashboard);
}

/* ================================ INICIO ================================= */
renderDashboard();
