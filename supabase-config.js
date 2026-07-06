"use strict";
/* ============================================================================
   CONFIGURACIÓN DE SUPABASE
   ----------------------------------------------------------------------------
   1. Crea un proyecto en https://supabase.com (gratis).
   2. Ejecuta el archivo setup.sql en el SQL Editor del proyecto.
   3. Ve a Project Settings -> API y copia aquí:
      - Project URL          -> SUPABASE_URL
      - anon public API key  -> SUPABASE_ANON_KEY
   La clave "anon" es pública por diseño: puede ir en el frontend.
   ============================================================================ */

const SUPABASE_URL = "https://hkwqwtvsebairolminvz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZudB9hsHkNiiVkHX15FUig_HpfuSn6B";

/* --------------------- Inicialización del cliente ----------------------- */
window.supabaseClient = null;

(function initSupabase() {
  const configured =
    !SUPABASE_URL.includes("TU-PROYECTO") &&
    !SUPABASE_ANON_KEY.includes("AQUI") &&
    typeof window.supabase !== "undefined";

  if (!configured) {
    console.warn(
      "[Familingo] Supabase sin configurar: la app funcionará en modo local " +
      "(localStorage). Edita supabase-config.js para activar la nube."
    );
    return;
  }

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { auth: { persistSession: false } } // sin login: perfiles fijos de la familia
  );
})();
