import Anthropic from '@anthropic-ai/sdk'

/**
 * Cliente de Claude, compartido por las funciones del servidor.
 *
 * VIVE ACÁ Y NO EN src/ A PROPÓSITO.
 *
 * Todo lo que Vite empaqueta termina dentro del JavaScript que descarga cada
 * visitante. Una clave de API en el frontend es una clave publicada: la lee
 * cualquiera abriendo las herramientas de desarrollo, y el consumo lo paga el
 * municipio. Por eso ANTHROPIC_API_KEY no lleva prefijo VITE_ y sólo existe
 * en el entorno del servidor de Vercel.
 */

export const MODELO_ANTHROPIC = 'claude-opus-5'

let cliente: Anthropic | null = null

export function getClaude(): Anthropic {
  if (!cliente) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('Falta ANTHROPIC_API_KEY en las variables de entorno del servidor.')
    }
    cliente = new Anthropic({ apiKey })
  }
  return cliente
}

/** ¿Está configurada la cuenta de Anthropic? Ver también proveedor.ts. */
export function hayClaveAnthropic(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Limitador de peticiones por IP, en memoria del proceso.
 *
 * No es una defensa fuerte —Vercel puede levantar varias instancias y el
 * contador no se comparte— pero frena el caso realista: alguien que encuentra
 * la URL del stand y la llama en bucle desde un script. Sin esto, cada
 * llamada gasta tokens que paga el municipio.
 */
const golpes = new Map<string, number[]>()

export function permitir(ip: string, maxPorMinuto: number): boolean {
  const ahora = Date.now()
  const ventana = ahora - 60_000
  const previos = (golpes.get(ip) ?? []).filter((t) => t > ventana)

  if (previos.length >= maxPorMinuto) {
    golpes.set(ip, previos)
    return false
  }

  previos.push(ahora)
  golpes.set(ip, previos)

  // Limpieza perezosa: el proceso puede vivir horas y el mapa no debe crecer
  // sin límite con IPs que pasaron una sola vez.
  if (golpes.size > 5000) {
    for (const [clave, marcas] of golpes) {
      if (marcas.every((t) => t <= ventana)) golpes.delete(clave)
    }
  }

  return true
}

export function ipDe(req: { headers: Record<string, string | string[] | undefined> }): string {
  const fwd = req.headers['x-forwarded-for']
  const valor = Array.isArray(fwd) ? fwd[0] : fwd
  return valor?.split(',')[0]?.trim() ?? 'desconocida'
}
