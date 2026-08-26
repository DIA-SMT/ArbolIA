/**
 * RNG determinista sembrado por string.
 *
 * Clave para la instalacion: la posicion de cada hoja se deriva del id de la
 * idea, no de Math.random(). Si la pantalla se recarga a mitad de ExpoCom
 * (o se cae el contexto WebGL y hay que remontar), el arbol se reconstruye
 * exactamente igual y nadie pierde su hoja de lugar.
 */
export function hashString(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Generador listo para usar a partir de cualquier clave estable. */
export function seededRandom(key: string): () => number {
  return mulberry32(hashString(key))
}

export function randomRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function randomInt(rng: () => number, min: number, maxExclusive: number): number {
  return Math.floor(min + rng() * (maxExclusive - min))
}
