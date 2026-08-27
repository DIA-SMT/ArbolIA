/**
 * Límite de peticiones por IP, en memoria del proceso.
 *
 * Vive aparte del cliente de Anthropic a propósito. Antes estaba en el
 * mismo módulo, así que los dos endpoints cargaban el SDK entero sólo para
 * contar peticiones — y con eso, cualquier problema al importar ese
 * paquete tumbaba las dos funciones aunque la instalación esté usando
 * OpenRouter, que no lo necesita para nada.
 *
 * No es una defensa fuerte: Vercel puede levantar varias instancias y el
 * contador no se comparte. Pero frena el caso realista, que es alguien que
 * encuentra la URL del stand y la llama en bucle desde un script. Cada
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

  // Limpieza perezosa: el proceso puede vivir horas y el mapa no debe
  // crecer sin límite con IPs que pasaron una sola vez.
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
