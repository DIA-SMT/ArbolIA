import { createClient } from '@supabase/supabase-js'

/**
 * Verificación de que quien llama es del equipo municipal.
 *
 * Migue ve las propuestas completas, con el rango etario de cada una. Sin
 * esta comprobación cualquiera con la URL podría pedirle un resumen de la
 * base entera — y de paso gastar tokens que paga el municipio.
 *
 * Son DOS preguntas, y hacen falta las dos:
 *
 *   1. ¿La sesión es real? Se valida el token contra Supabase en vez de
 *      decodificar el JWT acá: un JWT se puede fabricar, la respuesta de
 *      Supabase no.
 *
 *   2. ¿Esa persona es del equipo? Antes alcanzaba con la primera, y eso
 *      quería decir que cualquiera que se registrara podía consultarle a
 *      Migue el análisis completo. Ahora se pregunta por la lista de la
 *      migración 010, con el token de quien llama: la función usa
 *      auth.uid(), así que responde por esa persona y no por otra.
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
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data, error } = await db.auth.getUser(token)
    if (error || !data.user) return false

    const { data: autorizado, error: fallo } = await db.rpc('es_del_equipo')

    /*
     * Si la función todavía no existe —la migración 010 no corrió— se
     * niega el acceso en vez de dejarlo pasar.
     *
     * Es lo contrario de lo que hace la moderación, que falla abierta a
     * propósito para que un problema de red no deje a un vecino sin
     * participar. Acá lo que está del otro lado son datos internos: ante
     * la duda, no.
     */
    if (fallo) {
      console.error('[sesion] no se pudo comprobar el equipo:', fallo.message)
      return false
    }

    return autorizado === true
  } catch {
    return false
  }
}
