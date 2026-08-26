-- =====================================================================
--  Migración 006 — el nombre y la edad son datos internos
--
--  La regla del proyecto es que en el stand SÓLO se publica la propuesta.
--  El nombre y el rango etario existen para el informe posterior del
--  municipio, no para proyectarse.
--
--  Hasta acá eso era una convención del código: la pantalla no los pedía,
--  pero la política de lectura habilitaba SELECT sobre la fila entera, así
--  que cualquiera con la clave pública —que viaja al navegador de cada
--  visitante— podía pedirlos:
--
--    GET /rest/v1/ideas?select=author_name,age_range
--
--  RLS decide QUÉ FILAS se ven, no qué columnas. Para columnas el mecanismo
--  es el permiso a nivel de columna, que es lo que se aplica acá: el rol
--  anónimo pierde el SELECT general y recibe sólo las columnas públicas.
--  Ahora es estructuralmente imposible leer esos datos sin sesión, no una
--  cuestión de que el cliente "no los pida".
--
--  De paso sale device_id, que tampoco tiene por qué viajar al navegador:
--  es el identificador que agrupa los envíos de una misma persona.
--
--  El panel (rol authenticated) conserva acceso completo.
--
--  Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

do $guard$
begin
  if to_regclass('public.ideas') is null then
    raise exception
      'Falta el schema base. Ejecutá primero supabase/schema.sql en ESTE proyecto.';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------
-- 0. LIMPIAR LA FUNCIÓN DUPLICADA QUE DEJÓ LA MIGRACIÓN 005
--
--    `create or replace function` con distinta cantidad de parámetros NO
--    reemplaza: crea una sobrecarga. La 005 agregó la versión de cinco
--    parámetros y dejó viva la de tres, así que quedaron las dos y
--    PostgREST no puede elegir:
--
--      300  PGRST203  Could not choose the best candidate function
--
--    La app anda porque llama con los cinco, pero cualquier cliente que
--    llame con tres —una versión anterior del frontend, por ejemplo—
--    recibiría ese error en cada envío.
-- ---------------------------------------------------------------------
drop function if exists public.arbolia_submit_idea(text, text, text);

-- ---------------------------------------------------------------------
-- 1. COLUMNAS QUE PUEDE LEER EL PÚBLICO
-- ---------------------------------------------------------------------
revoke select on public.ideas from anon;

grant select (
  id,
  text,
  category,
  status,
  archived_at,
  created_at
) on public.ideas to anon;

-- El panel sigue viendo todo: es quien modera y quien arma el informe.
grant select on public.ideas to authenticated;

-- ---------------------------------------------------------------------
-- 2. LOS AGREGADOS SIGUEN FUNCIONANDO
--    arbolia_stats y arbolia_por_edad son SECURITY DEFINER, así que leen
--    con los permisos de su dueño y devuelven sólo totales. El público
--    puede saber que 40 personas de 30 a 44 participaron, sin poder leer
--    quiénes son.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 3. VERIFICACIÓN
--    Deja constancia en los logs de qué columnas quedaron accesibles.
-- ---------------------------------------------------------------------
do $check$
declare
  internas text[] := array['author_name', 'age_range', 'device_id'];
  col      text;
  expuesta text;
begin
  -- has_column_privilege consulta el permiso directamente, sin depender de
  -- la forma de las vistas del catálogo.
  foreach col in array internas loop
    if has_column_privilege('anon', 'public.ideas', col, 'SELECT') then
      expuesta := coalesce(expuesta || ', ', '') || col;
    end if;
  end loop;

  if expuesta is not null then
    raise exception
      'Estas columnas siguen siendo legibles por el público: %. Los grants no se aplicaron.',
      expuesta;
  end if;

  raise notice 'OK: nombre, edad e identificador de dispositivo quedaron fuera del alcance público.';
end;
$check$;
