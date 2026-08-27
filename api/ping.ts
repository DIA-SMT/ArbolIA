/**
 * Diagnóstico del entorno de las funciones.
 *
 * No importa NADA: ni el SDK, ni Supabase, ni los tipos de Vercel. Existe
 * para separar dos causas que desde afuera se ven igual, porque las dos
 * devuelven FUNCTION_INVOCATION_FAILED:
 *
 *   · algo de nuestro código revienta al cargarse, o
 *   · el runtime de funciones no está levantando ninguna función.
 *
 * Si /api/ping responde y las otras dos no, el problema es nuestro. Si
 * tampoco responde, es configuración del despliegue y no hay código que
 * revisar.
 *
 * También informa qué ve el proceso, que es lo otro que no se puede saber
 * desde afuera: la versión de Node y si las variables de entorno llegaron.
 * NUNCA el valor de una clave — sólo si está y cuánto mide, que alcanza
 * para detectar una pegada a medias o con espacios de más.
 */

interface Respuesta {
  status: (codigo: number) => Respuesta
  json: (cuerpo: unknown) => Respuesta
}

export default function handler(_req: unknown, res: Respuesta) {
  const ver = (nombre: string) => {
    const v = process.env[nombre]
    return v ? { puesta: true, largo: v.length } : { puesta: false, largo: 0 }
  }

  return res.status(200).json({
    ok: true,
    node: process.version,
    region: process.env.VERCEL_REGION ?? null,
    entorno: process.env.VERCEL_ENV ?? null,
    variables: {
      OPENROUTER_API_KEY: ver('OPENROUTER_API_KEY'),
      OPENROUTER_MODELO: process.env.OPENROUTER_MODELO ?? null,
      IA_PROVEEDOR: process.env.IA_PROVEEDOR ?? null,
      ANTHROPIC_API_KEY: ver('ANTHROPIC_API_KEY'),
      SUPABASE_URL: ver('SUPABASE_URL'),
      VITE_SUPABASE_URL: ver('VITE_SUPABASE_URL'),
      VITE_SUPABASE_ANON_KEY: ver('VITE_SUPABASE_ANON_KEY'),
    },
  })
}
