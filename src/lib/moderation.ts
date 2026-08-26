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
 * Deshace las sustituciones de tipo "leet".
 *
 * Un vecino escribió "gestion de m1erd4" y pasó entero: el filtro comparaba
 * letras, y ahí no hay ninguna palabra de la lista. Con 1 por i, 4 por a y
 * 0 por o se evade cualquier lista de términos, y es lo primero que prueba
 * quien quiere colar algo.
 *
 * Se usa como comparación ADICIONAL, no en reemplazo: convertir dígitos a
 * letras en todo texto podría deformar propuestas legítimas que hablan de la
 * ruta 9 o de plantar 100 árboles.
 */
const LEET_DE = '013457@$!'
const LEET_A = 'oieastasi'

function deshacerLeet(texto: string): string {
  let out = ''
  for (const c of texto) {
    const i = LEET_DE.indexOf(c)
    out += i >= 0 ? LEET_A[i] : c
  }
  return out
}

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

  // Misma comparación sobre el texto con los dígitos revertidos a letras.
  const conLeet =
    !directo && BLOCKED.some((w) => contienePalabra(deshacerLeet(normalized), w))

  const evasion =
    !directo &&
    !conLeet &&
    pareceEvasion(normalized) &&
    BLOCKED.some((w) => normalized.replace(/[^a-z0-9]/g, '').includes(w.replace(/\s/g, '')))

  if (directo || conLeet || evasion) {
    return {
      ok: false,
      reason: 'Revisá el texto: hay palabras que no podemos publicar en la pantalla.',
    }
  }

  return { ok: true }
}
