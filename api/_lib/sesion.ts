import { createClient } from '@supabase/supabase-js'

/**
 * Verificación de que quien llama es del equipo municipal.
 *
 * Migue ve las propuestas completas, incluidos nombre y rango etario, que son
 * datos internos. Sin esta comprobación cualquiera con la URL podría pedirle
 * un resumen de la base entera — y de paso gastar tokens que paga el
 * municipio.
 *
 * Se valida el token contra Supabase, no se decodifica el JWT acá: un JWT se
 * puede fabricar, la respuesta de Supabase no.
 */
export async function esDelEquipo(authHeader: string | undefined): Promise<boolean> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anon) return false

  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false

  try {
    const db = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await db.auth.getUser(token)
    return !error && Boolean(data.user)
  } catch {
    return false
  }
}
