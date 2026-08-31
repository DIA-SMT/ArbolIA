/**
 * Viento del árbol, compartido entre la corteza y el follaje.
 *
 * Es una sola función GLSL que se inyecta en los dos shaders. Que sea LA
 * MISMA es el punto: si las ramas se mueven con una fórmula y las hojas con
 * otra, el follaje se despega de la madera en cada ráfaga y el efecto queda
 * peor que sin viento.
 *
 * No es una simulación física: no hay masas, resortes ni integración. Es
 * ruido periódico bien elegido, que a esta escala y a la distancia de un
 * stand se lee igual y cuesta cero.
 *
 * DOS MOVIMIENTOS, NO UNO.
 *
 * La versión anterior tenía sólo el segundo, y el árbol se leía quieto: la
 * punta más movediza recorría unos cuatro píxeles en pantalla. Peor, la
 * flexión salía del grosor del tubo, que es CONSTANTE a lo largo de cada
 * ramita, así que cada una se trasladaba entera en bloque en vez de
 * doblarse — y en cada nudo la hija se corría más que la punta de la madre
 * a la que está pegada, abriendo la estructura por las axilas.
 *
 *  · BALANCEO GLOBAL: todo el árbol se inclina como una masa, con la
 *    amplitud creciendo con la altura. Es lo único que se lee de lejos,
 *    porque mueve la silueta entera contra el fondo. Depende sólo de la
 *    altura y de constantes compartidas, así que tronco, ramas y hojas se
 *    inclinan exactamente igual y quedan soldados.
 *
 *  · DOBLEZ LOCAL: encima del balanceo, cada rama se dobla desde su axila
 *    hacia su punta. Quien manda es la coordenada de voladizo, no el
 *    grosor: vale cero donde nace la rama y uno en la punta, y es continua
 *    en el nudo porque madre e hija comparten el valor donde se tocan.
 *
 * Todo se evalúa en espacio de OBJETO, antes de la matriz del modelo. Antes
 * la corteza usaba coordenadas de mundo y las hojas coordenadas locales:
 * estaban literalmente en fases distintas, que es lo contrario de lo que
 * promete el párrafo de arriba. Además así el viento escala junto con el
 * árbol cuando la copa crece.
 */

/** Hacia dónde sopla, en el plano del suelo. Normalizado. */
const DIRECCION = 'vec2(0.86, 0.51)'

/**
 * Cuánto se inclina el árbol entero.
 *
 * Constante compartida y no uniform por material a propósito: si el tronco
 * y una rama pudieran tener valores distintos, la estructura volvería a
 * abrirse por las axilas. Si en el LED se ve gomoso, bajar a 0.025.
 */
const BALANCEO = '0.035'

export const WIND_GLSL = /* glsl */ `
  uniform float uWindTime;
  uniform float uWindStrength;

  const vec2  ARBOLIA_DIR = ${DIRECCION};
  const float ARBOLIA_BALANCEO = ${BALANCEO};

  /* La ráfaga: dos períodos incomensurables, así no se repite a ojo. Un
     viento parejo se nota falso enseguida; lo que da vida es que arrecie
     y afloje. Se exporta porque la luz de la copa también la usa. */
  float arboliaGust(float t) {
    return 0.34 + 0.66 * (0.5 + 0.5 * sin(t * 0.21)) * (0.6 + 0.4 * sin(t * 0.083 + 1.7));
  }

  /* Balanceo global: el árbol se inclina entero. */
  vec3 arboliaSway(vec3 p) {
    float t = uWindTime;
    float h = clamp(max(p.y, 0.0) / 3.2, 0.0, 1.5);
    float doblez = h * h;

    float lento = sin(t * 0.29) * 0.62 + sin(t * 0.113 + 2.1) * 0.38;
    float a = (0.45 + 0.55 * lento) * arboliaGust(t) * doblez * ARBOLIA_BALANCEO;

    /* La punta BAJA cuando se va de lado. Es media línea y es la diferencia
       entre doblarse y estirarse: sin esto el árbol crece al inclinarse. */
    return vec3(ARBOLIA_DIR.x * a, -abs(a) * 0.12, ARBOLIA_DIR.y * a);
  }

  /* Doblez local + balanceo. El parametro flex es la coordenada de voladizo:
     cero en la axila, uno en la punta. */
  vec3 arboliaWind(vec3 p, float flex) {
    vec3 global = arboliaSway(p);
    if (flex <= 0.0001) return global;

    float t = uWindTime;

    /* Fase por posición: las ramas no llegan todas juntas al mismo punto
       del ciclo. */
    float phase = p.x * 1.7 + p.z * 1.35 + p.y * 0.42;

    float sway   = sin(t * 0.66 + phase);
    float sway2  = sin(t * 0.37 + phase * 0.6);
    float tremor = sin(t * 2.1 + phase * 1.9) * 0.3;

    float amp = flex * arboliaGust(t) * uWindStrength;

    /* Sesgado hacia la dirección del viento: una rama no oscila alrededor
       de su reposo, se va para donde sopla y vuelve un poco. */
    vec2 lateral = ARBOLIA_DIR * (sway * 0.35 + 0.5) * amp * 1.1;

    vec3 local = vec3(
      lateral.x + (sway + tremor) * amp * 0.55,
      (sway2 * 0.22 - abs(sway) * 0.1) * amp,
      lateral.y + (cos(t * 0.54 + phase * 0.95) + tremor * 0.55) * amp * 0.55
    );

    return global + local;
  }
`

/** Uniformes que necesita `WIND_GLSL`. Se agregan a cada material. */
export function windUniforms(strength: number) {
  return {
    uWindTime: { value: 0 },
    uWindStrength: { value: strength },
  }
}
