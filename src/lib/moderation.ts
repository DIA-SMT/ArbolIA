/**
 * Filtro liviano del lado del cliente.
 *
 * No es la defensa real — esa es el trigger de Postgres, que corre sí o sí.
 * Este existe por UX: si alguien escribe un insulto, conviene decírselo en el
 * momento para que lo corrija, en vez de aceptarlo en silencio y dejarlo
 * esperando frente a la pantalla una hoja que nunca va a aparecer.
 *
 * COMPARA PALABRAS COMPLETAS, no fragmentos. Antes buscaba subcadenas y eso
 * rechazaba ideas legítimas acusando al vecino de escribir un insulto:
 * "computadoras" contiene "puta", "controlar" contiene "trola", y también
 * caían "diputada", "disputa" y "computación". Seis de cada nueve ideas
 * normales quedaban marcadas.
 */
const BLOCKED = [
  'puto', 'puta', 'putos', 'putas', 'mierda', 'conchudo',
  'pelotudo', 'pelotuda', 'boludo', 'boluda', 'forro', 'forra',
  'carajo', 'joder', 'cagada', 'verga', 'pija', 'choto',
  'trolo', 'trola', 'sorete', 'imbecil', 'idiota', 'estupido',
  'negro de mierda', 'villero', 'sudaca', 'maricon',
  'hijo de puta', 'la concha de', 'andate a la',
  'ladron', 'ladrones', 'chorro', 'chorros', 'coima', 'coimero',
  'fuck', 'shit', 'bitch', 'asshole',
]

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * ¿El texto muestra el patrón de una evasión deliberada?
 *
 * Es decir letras sueltas separadas por símbolos o espacios: "p-u-t-o",
 * "p.u.t.o", "p u t o". Sólo en ese caso vale comparar el texto compactado,
 * que es lo que atrapa la evasión pero también lo que producía los falsos
 * positivos si se aplicaba a cualquier frase.
 */
function pareceEvasion(texto: string): boolean {
  return /(^|[^a-z0-9])([a-z][^a-z0-9]+){2,}[a-z]($|[^a-z0-9])/i.test(texto)
}

function contienePalabra(normalizado: string, palabra: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapar(palabra)}([^a-z0-9]|$)`).test(normalizado)
}

export interface ModerationResult {
  ok: boolean
  reason?: string
}

export function checkIdeaText(text: string): ModerationResult {
  const trimmed = text.trim()

  if (trimmed.length < 3) {
    return { ok: false, reason: 'Escribí un poco más para que se entienda tu idea.' }
  }

  const normalized = normalize(trimmed)

  if (!/[a-z]/.test(normalized)) {
    return { ok: false, reason: 'Tu idea necesita al menos algunas palabras.' }
  }

  const directo = BLOCKED.some((w) => contienePalabra(normalized, w))

  const evasion =
    !directo &&
    pareceEvasion(normalized) &&
    BLOCKED.some((w) => normalized.replace(/[^a-z0-9]/g, '').includes(w.replace(/\s/g, '')))

  if (directo || evasion) {
    return {
      ok: false,
      reason: 'Revisá el texto: hay palabras que no podemos publicar en la pantalla.',
    }
  }

  return { ok: true }
}
