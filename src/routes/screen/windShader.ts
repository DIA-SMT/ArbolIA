/**
 * Viento del árbol, compartido entre la corteza y el follaje.
 *
 * Es una sola función GLSL que se inyecta en los dos shaders. Que sea LA
 * MISMA es el punto: si las ramas se mueven con una fórmula y las hojas con
 * otra, el follaje se despega de la madera en cada ráfaga y el efecto queda
 * peor que sin viento. Compartiendo la función, una ramita y las hojas que
 * cuelgan de ella se desplazan casi lo mismo y el conjunto se lee sólido.
 *
 * No es una simulación física: no hay masas, resortes ni integración. Es
 * ruido periódico bien elegido, que a esta escala y a la distancia de un
 * stand se lee igual y cuesta cero.
 *
 * Tres capas:
 *  - Ráfaga: el viento sube y baja con un período largo. Un viento parejo
 *    se nota falso enseguida; lo que da vida es que arrecie y afloje.
 *  - Balanceo: la oscilación lenta y amplia.
 *  - Temblor: una frecuencia rápida y chica encima, que es lo que hace que
 *    las puntas finas "vibren" mientras la rama gruesa apenas se mece.
 *
 * `flex` es cuánto se dobla esa parte del árbol: cero en el tronco y en las
 * raíces, máximo en las ramitas terminales.
 */
export const WIND_GLSL = /* glsl */ `
  uniform float uWindTime;
  uniform float uWindStrength;

  vec3 arboliaWind(vec3 worldPos, float flex) {
    if (flex <= 0.0001) return vec3(0.0);

    float t = uWindTime;

    // Ráfaga: dos períodos incomensurables, así no se repite a ojo.
    float gust = 0.42 + 0.58 * (0.5 + 0.5 * sin(t * 0.21)) * (0.6 + 0.4 * sin(t * 0.083 + 1.7));

    // Fase por posición: el árbol no se mueve todo junto como un bloque.
    float phase = worldPos.x * 1.7 + worldPos.z * 1.35 + worldPos.y * 0.42;

    float sway   = sin(t * 0.66 + phase);
    float tremor = sin(t * 2.1 + phase * 1.9) * 0.3;

    float amp = flex * gust * uWindStrength;

    return vec3(
      (sway + tremor) * amp,
      sway * 0.16 * amp,
      (cos(t * 0.54 + phase * 0.95) + tremor * 0.55) * amp
    );
  }
`

/** Uniformes que necesita `WIND_GLSL`. Se agregan a cada material. */
export function windUniforms(strength: number) {
  return {
    uWindTime: { value: 0 },
    uWindStrength: { value: strength },
  }
}
