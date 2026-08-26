import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { IS_SUPABASE_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/*
 * DOS CLIENTES, a propósito.
 *
 * Había uno solo, con sesión persistida, y eso produjo un fallo grave: si
 * alguien del equipo entraba a /admin en el mismo navegador donde corre la
 * pantalla, Supabase guardaba la sesión en localStorage y la pantalla pasaba
 * a consultar como usuario autenticado. Las políticas de RLS son permisivas
 * —se suman con OR—, así que la regla del panel (`to authenticated using
 * (true)`) le daba acceso a TODO: las ideas moderadas aparecían proyectadas
 * en el árbol y en la lista de últimas ideas.
 *
 * Separarlos elimina la clase de error entera: la pantalla y el celular
 * consultan siempre como anónimos, sin importar quién esté logueado en esa
 * máquina.
 */

const realtimeConfig = {
  params: {
    // La pantalla puede recibir rafagas cuando hay cola en el stand.
    eventsPerSecond: 20,
  },
}

/**
 * Cliente de las rutas públicas: pantalla y celular.
 *
 * `persistSession: false` es lo que importa — no lee ni escribe el storage,
 * así que nunca hereda una sesión de administrador abierta en otra pestaña.
 */
export const supabasePublic: SupabaseClient | null = IS_SUPABASE_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      realtime: realtimeConfig,
      global: { headers: { 'x-arbolia-client': 'expocom-2026-publico' } },
    })
  : null

/** Cliente del panel: mantiene la sesión del equipo municipal. */
export const supabase: SupabaseClient | null = IS_SUPABASE_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'arbolia-admin',
      },
      realtime: realtimeConfig,
      global: { headers: { 'x-arbolia-client': 'expocom-2026-admin' } },
    })
  : null

function faltaConfig(): never {
  throw new Error(
    'Supabase no está configurado. Definí VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
  )
}

/** Para lo que ve el público: nunca con sesión de administrador. */
export function requirePublic(): SupabaseClient {
  return supabasePublic ?? faltaConfig()
}

/** Para el panel: requiere la sesión del equipo. */
export function requireSupabase(): SupabaseClient {
  return supabase ?? faltaConfig()
}
