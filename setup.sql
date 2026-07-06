	-- ============================================================================
-- Familingo — Esquema de base de datos para Supabase
-- Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1) Tabla de progreso por usuario
create table if not exists public.user_progress (
  id             bigint generated always as identity primary key,
  user_name      text        not null unique,
  current_level  int         not null default 1 check (current_level between 1 and 4),
  current_unit   int         not null default 1 check (current_unit between 1 and 10),
  current_lesson int         not null default 1 check (current_lesson between 1 and 5),
  streak_count   int         not null default 0,
  xp_total       int         not null default 0,
  hearts         int         not null default 5 check (hearts between 0 and 5),
  last_active    date,
  -- Mapa completo del árbol: { "units": { "0-0": 5, "0-1": 2, ... } }
  -- (clave "nivel-unidad" -> lecciones completadas en esa unidad)
  progress       jsonb       not null default '{}'::jsonb,
  -- Identificador del dispositivo que escribió por última vez
  -- (evita ecos en la sincronización en tiempo real)
  last_client    text,
  updated_at     timestamptz not null default now()
);

-- 2) Seguridad: RLS activado con acceso anónimo de lectura/escritura.
--    (App familiar sin login; la clave anon solo permite operar esta tabla.)
alter table public.user_progress enable row level security;

drop policy if exists "anon puede leer"       on public.user_progress;
drop policy if exists "anon puede insertar"   on public.user_progress;
drop policy if exists "anon puede actualizar" on public.user_progress;

create policy "anon puede leer"
  on public.user_progress for select to anon using (true);

create policy "anon puede insertar"
  on public.user_progress for insert to anon with check (true);

create policy "anon puede actualizar"
  on public.user_progress for update to anon using (true) with check (true);

-- 3) Crear los 4 perfiles fijos
insert into public.user_progress (user_name)
values ('Antón'), ('Pepa'), ('Lázaro'), ('Carlos')
on conflict (user_name) do nothing;

-- 4) Activar la sincronización en tiempo real sobre la tabla
alter publication supabase_realtime add table public.user_progress;
