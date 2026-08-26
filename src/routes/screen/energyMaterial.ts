import * as THREE from 'three'
import { WIND_GLSL, windUniforms } from './windShader'

/**
 * Corteza con savia circulando.
 *
 * Tres capas, en orden de importancia visual:
 *
 *  1. Volumen. Una luz direccional falsa desde arriba y al frente. Sin esto
 *     la madera se lee plana y todo el árbol parece un esquema de líneas:
 *     es lo que más distingue una silueta con masa de un dibujo vectorial.
 *  2. Borde. Un fresnel angosto que despega la silueta del fondo oscuro en
 *     pantalla grande. Angosto a propósito: un fresnel ancho ilumina toda la
 *     superficie y devuelve el aspecto de neón.
 *  3. Savia. Pulsos que recorren el eje del tubo, hacia adentro en las
 *     raíces y hacia afuera en las ramas. Son eventos, no un brillo constante.
 *
 * El atributo aThickness (1 = tronco, 0 = ramita) hace que la madera gruesa
 * sea mate y la fina, luminosa, como pasa con los brotes nuevos.
 */

const vertexShader = /* glsl */ `
  ${WIND_GLSL}

  attribute float aThickness;

  varying vec2  vUv;
  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vThickness;
  varying float vHeight;

  void main() {
    vUv = uv;
    vThickness = aThickness;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);

    /*
     * Flexión de la madera.
     *
     * El cuadrado de (1 - grosor) hace la diferencia entre una rama que se
     * mece y un árbol de goma: el tronco queda clavado, las ramas medias
     * apenas acompañan y sólo las ramitas finas se agitan de verdad. Y se
     * anula bajo tierra, porque una raíz que ondea rompe todo el efecto.
     */
    float taper  = 1.0 - clamp(aThickness, 0.0, 1.0);
    float upward = smoothstep(0.0, 1.6, worldPos.y);
    float flex   = taper * taper * upward;

    worldPos.xyz += arboliaWind(worldPos.xyz, flex);

    vHeight = worldPos.y;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3  uBark;
  uniform vec3  uEnergy;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uPulseCount;
  uniform float uDirection;
  uniform float uRimPower;
  uniform float uReveal;

  varying vec2  vUv;
  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vThickness;
  varying float vHeight;

  void main() {
    /*
     * Crecimiento de las raíces.
     *
     * La geometría se genera siempre a largo completo y el shader recorta
     * lo que todavía no creció. Sale más barato y se ve mejor que regenerar
     * geometría: la raíz avanza de verdad hacia afuera, con una punta
     * encendida donde se está formando, en vez de estirarse de golpe.
     */
    if (vUv.x > uReveal) discard;

    vec3 normal = normalize(vNormalW);

    // ---- 1. Volumen ----
    // Luz principal alta y algo lateral, más un relleno frío desde abajo
    // para que la cara en sombra no se hunda en negro puro.
    vec3  keyDir  = normalize(vec3(0.45, 1.0, 0.35));
    float key     = max(dot(normal, keyDir), 0.0);
    float fill    = max(dot(normal, normalize(vec3(-0.5, -0.3, -0.6))), 0.0);

    vec3 lit = uBark * (0.34 + key * 0.95);
    lit += uBark * fill * 0.4;

    // Las ramitas finas son más claras que la madera gruesa.
    lit *= mix(1.55, 0.92, vThickness);

    // ---- 2. Borde ----
    float rim = pow(1.0 - max(dot(normal, normalize(vViewDir)), 0.0), uRimPower);
    lit += uEnergy * rim * 0.5 * uIntensity;

    // ---- 3. Savia ----
    float flow  = fract(vUv.x * uPulseCount - uTime * uSpeed * uDirection);
    float pulse = smoothstep(0.0, 0.03, flow) * (1.0 - smoothstep(0.03, 0.19, flow));

    // Se desvanecen en los extremos para que no aparezcan de golpe.
    float ends = smoothstep(0.0, 0.1, vUv.x) * (1.0 - smoothstep(0.9, 1.0, vUv.x));
    pulse *= ends;

    // Más visible en las ramitas finas, donde la savia "se transparenta".
    pulse *= mix(1.4, 0.75, vThickness);
    lit += uEnergy * pulse * 0.95 * uIntensity;

    // Punta de crecimiento: donde la raíz se está formando, brilla.
    float tip = smoothstep(uReveal - 0.1, uReveal, vUv.x);
    lit += uEnergy * tip * 1.1 * step(uReveal, 0.999);

    // Latido general muy leve: el árbol nunca queda del todo quieto.
    lit *= 0.95 + 0.05 * sin(uTime * 0.6 + vHeight * 0.8);

    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
  }
`

export interface EnergyMaterialOptions {
  energyColor: string
  barkColor?: string
  speed?: number
  intensity?: number
  pulseCount?: number
  /** 1 = hacia la punta, -1 = hacia el tronco. */
  direction?: number
  rimPower?: number
  /** Fracción del recorrido que se dibuja: 1 = completo. */
  reveal?: number
  /** Sólo para lo que crece: el corte del discard deja el tubo abierto. */
  doubleSided?: boolean
  /** Amplitud del viento. 0 para lo que no debe moverse (raíces). */
  windStrength?: number
}

export function createEnergyMaterial(options: EnergyMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uBark: { value: new THREE.Color(options.barkColor ?? '#12212e') },
      uEnergy: { value: new THREE.Color(options.energyColor) },
      uSpeed: { value: options.speed ?? 0.14 },
      uIntensity: { value: options.intensity ?? 1 },
      uPulseCount: { value: options.pulseCount ?? 1.5 },
      uDirection: { value: options.direction ?? 1 },
      uRimPower: { value: options.rimPower ?? 3.5 },
      // Un pelo por encima de 1: el interpolador puede devolver 1.0000001 en
      // el ultimo anillo de vertices y el discard comeria esa fila de pixeles.
      uReveal: { value: options.reveal ?? 1.001 },
      ...windUniforms(options.windStrength ?? 0.03),
    },
    /*
     * FrontSide salvo en lo que crece. El discard abre el tubo por la
     * punta y sin cara interna la raíz en formación se vería hueca; pero
     * DoubleSide en todo el árbol duplicaría el relleno de píxeles al
     * pedo, y el relleno es justo lo que escasea en una GPU integrada.
     */
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  })
}
