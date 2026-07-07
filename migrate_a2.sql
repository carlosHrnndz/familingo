-- ============================================================================
-- Familingo — Migración para la sección A2 (14 unidades por sección)
-- Ejecutar UNA VEZ en: Supabase -> SQL Editor -> New query -> Run
-- (Amplía el CHECK de current_unit de 1-10 a 1-14; el resto no cambia.)
-- ============================================================================

alter table public.user_progress
  drop constraint if exists user_progress_current_unit_check;

alter table public.user_progress
  add constraint user_progress_current_unit_check
  check (current_unit between 1 and 14);
