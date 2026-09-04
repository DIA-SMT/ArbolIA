import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CIELO, type Tema } from './temaEscena'

/**
 * El cielo: un cilindro pegado al ojo.
 *
 * POR QUÉ EXISTE. El árbol estaba parado en la nada — un color plano
 * detrás, sin arriba ni abajo. Con un cielo de verdad arriba y una tierra
 * abajo, la separación que la instalación necesita contar —la comunidad en
 * las raíces, las ideas en la copa— pasa a leerse de un vistazo.
 *
 * POR QUÉ UN CILINDRO ANCLADO A LA CÁMARA Y NO UN DOMO EN EL MUNDO.
 *
 * La cámara de esta escena orbita 360° sin parar, y su radio se mueve 4,1
 * veces entre Brote y Pleno porque el encuadre se recalcula con la escala
 * del árbol. Cualquier geometría de fondo puesta en el mundo hereda tres
 * problemas de eso, y los tres son de los que aparecen recién en la feria:
 *
 *   · un domo de radio fijo funciona en Brote y en Pleno deja a la cámara
 *     AFUERA — la pantalla se llena del color plano de su cara interna;
 *   · a escala 1.3 con celebración la cámara llega a 30.3 y el plano lejano
 *     está en 60, así que no queda radio válido para un domo centrado en el
 *     origen sin que el casquete se recorte contra el far;
 *   · un plano fijo, como el telón que ya existía, pasa ENTRE la cámara y
 *     el árbol media vuelta de cada 114 segundos.
 *
 * Anclado al ojo, ninguna de las tres preguntas se puede ni formular: no
 * hay radio que cruzar, no hay adentro ni afuera, no hay un lado. El
 * cilindro va donde va la cámara y lo único que cambia es hacia dónde mira.
 *
 * POR QUÉ NO ESCRIBE NI LEE PROFUNDIDAD. Con depthTest y depthWrite en
 * false y renderOrder -1000 es el primer dibujo del cuadro y no deja una
 * sola muestra en el z-buffer. Todo lo demás —raíces, tronco, hojas, la
 * partícula, las motas, los bichos— se dibuja encima sin excepción y sin
 * ninguna prueba que lo pueda rechazar. La garantía es estructural, no una
 * calibración que se rompa cuando el árbol crezca.
 *
 * RADIO 1, Y ES LO QUE HACE BARATO AL SHADER. Sobre un cilindro de radio 1
 * centrado en el ojo, la coordenada `y` de un punto ES la tangente de su
 * elevación: tan(e) = y / 1. Interpolada con corrección de perspectiva
 * llega exacta a cada fragmento, así que el degradado no necesita
 * normalize(), ni atan(), ni pow() — que es justo lo caro cuando el
 * fragmento corre sobre el cuadro entero en la placa integrada del stand.
 *
 * OJO CON UNA COSA: el ecuador de este cilindro es la línea del ojo, o sea
 * el horizonte VERDADERO, y ahí NO va la línea de tierra. Medido en la
 * escena: el horizonte del ojo cae al 38 % del alto de cuadro y la base del
 * árbol al 65,5 %. Una línea de tierra en el ecuador cortaría la copa por
 * la mitad y dejaría más de medio árbol por debajo del nivel del suelo:
 * diría que las ideas están enterradas. Por eso acá abajo del ecuador no
 * hay tierra, hay lejanía — y la línea de suelo la dibuja el borde del
 * disco de Atmosphere, que sí está en y=0.
 */

/** Alto local del cilindro, o sea hasta qué |tan(elevación)| cubre. */
const ALTO = 2.9

const vertexShader = /* glsl */ `
  varying float vTan;
  varying vec2  vUv;

  void main() {
    /*
     * Con radio 1 y el ojo en el centro, position.y ES tan(elevación).
     * No hace falta ninguna función trigonométrica en el fragmento.
     */
    vTan = position.y;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3  uCenit;
  uniform vec3  uHorizonte;
  uniform vec3  uNube;
  uniform float uNubeFuerza;
  uniform float uTechoLuz;
  uniform sampler2D uMascara;

  varying float vTan;
  varying vec2  vUv;

  void main() {
    /*
     * Degradado. La potencia baja concentra el cambio cerca del horizonte,
     * que es donde el aire se acumula y aclara en un cielo real; con una
     * rampa lineal el cielo se lee como un degradado de software.
     */
    float h = clamp(vTan * 1.35, -1.0, 1.0);
    vec3 col = mix(uHorizonte, uCenit, pow(clamp(h, 0.0, 1.0), 0.55));

    /*
     * Debajo de la línea del ojo NO hay tierra: hay lejanía. La tierra la
     * dibuja el disco de Atmosphere, que está en y=0 y no acá. Lo que pasa
     * bajo el ecuador es que el cielo se cierra un poco, como el aire
     * espeso del fondo de un descampado.
     */
    col = mix(col, uHorizonte * 0.88, clamp(-h * 1.4, 0.0, 1.0));

    /*
     * Nubes. La máscara es de UN canal y es la MISMA en los dos temas: todo
     * el color vive en uniformes. Eso es lo que va a permitir que el día se
     * vuelva noche interpolando colores, sin regenerar una textura ni
     * recompilar un shader a mitad de la transición.
     *
     * Sólo se leen por encima del horizonte, y como el corte es una línea
     * horizontal en pantalla los warps de la mitad de abajo no toman la
     * rama: se ahorra cerca de la mitad de los accesos de una pasada de
     * cuadro completo.
     */
    if (h > 0.0) {
      float n = texture2D(uMascara, vUv).r;
      // Se desvanecen contra el horizonte y contra el cenit: una nube
      // pegada al borde del cuadro delata que el cielo es un cilindro.
      float cinturon = smoothstep(0.02, 0.3, h) * (1.0 - smoothstep(0.62, 1.0, h));
      col = mix(col, uNube, n * uNubeFuerza * cinturon);
    }

    /*
     * Techo de luminancia, por las malas. En oscuro el bloom toma todo lo
     * que pase 0.16 y este shader pinta el cuadro entero. Una paleta
     * prudente no alcanza como defensa porque Sol tiñe el cielo en vivo
     * durante los 45 segundos del paso del astro.
     */
    float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= min(1.0, uTechoLuz / max(L, 1e-4));

    /*
     * Dither de gradiente entrelazado. El degradado nocturno entero vive en
     * unos catorce niveles de 8 bits; repartidos sobre mil ochenta píxeles
     * de alto son franjas cada ochenta píxeles, y un cielo bandeado en una
     * pantalla LED grande se ve de la otra punta del pabellón.
     */
    col += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

/**
 * Máscara de nubes: un canal, sin color, la misma para los dos temas.
 *
 * Horneada una vez en canvas, como el resto de las texturas del proyecto
 * (ver leafAssets y las del suelo en Atmosphere): la instalación tiene que
 * levantar aunque el predio no tenga red al abrir.
 *
 * Envuelve en U porque el cilindro da la vuelta entera y una costura
 * visible sería lo único que delataría la geometría.
 */
function crearMascaraDeNubes(): THREE.Texture {
  const ancho = 1024
  const alto = 256
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, ancho, alto)

  /*
   * Cúmulos: manchas blandas apiladas. Sin azar: una secuencia
   * determinista, así el cielo es idéntico en cada carga y en cada máquina
   * del stand. Nada de Math.random acá.
   */
  let semilla = 20260903
  const rnd = () => {
    semilla = (semilla * 1664525 + 1013904223) % 4294967296
    return semilla / 4294967296
  }

  ctx.globalCompositeOperation = 'lighter'
  const CUMULOS = 26
  for (let i = 0; i < CUMULOS; i++) {
    const cx = rnd() * ancho
    const cy = alto * (0.25 + rnd() * 0.55)
    const escala = 0.55 + rnd() * 0.9
    const bollos = 5 + Math.floor(rnd() * 5)

    for (let b = 0; b < bollos; b++) {
      const dx = (rnd() - 0.5) * 190 * escala
      // Achatados: una nube es más ancha que alta.
      const dy = (rnd() - 0.5) * 34 * escala
      const r = (26 + rnd() * 46) * escala

      // Se dibuja tres veces desplazado un ancho: el que cruza el borde
      // aparece del otro lado y la costura desaparece.
      for (const off of [-ancho, 0, ancho]) {
        const g = ctx.createRadialGradient(cx + dx + off, cy + dy, 0, cx + dx + off, cy + dy, r)
        g.addColorStop(0, 'rgba(255,255,255,0.5)')
        g.addColorStop(0.45, 'rgba(255,255,255,0.22)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx + dx + off, cy + dy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  // Sin colorSpace sRGB: no es color, es una máscara. Convertirla
  // desharía justamente lo que la hace servir para los dos temas.
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

export default function Cielo({ tema = 'oscuro' }: { tema?: Tema }) {
  const malla = useRef<THREE.Mesh>(null)
  const { scene } = useThree()
  const ap = CIELO[tema]

  const mascara = useMemo(crearMascaraDeNubes, [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uCenit: { value: new THREE.Color(ap.cenit) },
          uHorizonte: { value: new THREE.Color(ap.horizonte) },
          uNube: { value: new THREE.Color(ap.nube) },
          uNubeFuerza: { value: ap.nubeFuerza },
          uTechoLuz: { value: ap.techoLuz },
          uMascara: { value: mascara },
        },
        // Lo vemos desde adentro: la cara que mira al ojo es la interna.
        side: THREE.BackSide,
        /*
         * Opaco, sin prueba ni escritura de profundidad, y el primero de
         * la cola. Ver el comentario de arriba: es lo que garantiza que
         * nunca pueda tapar nada.
         */
        transparent: false,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    [ap, mascara],
  )

  /*
   * El tinte del astro, sin tocar una línea de Sol.tsx.
   *
   * Sol sigue escribiendo scene.background como siempre. Acá se lee cuánto
   * se corrió respecto del fondo neutro del tema y ese mismo corrimiento se
   * le suma al cielo. O sea: el amanecer sigue viviendo donde vivía, y el
   * cielo nuevo lo obedece en vez de pisarlo.
   *
   * El horizonte se tiñe más que el cenit —1.25 contra 0.8— porque es lo
   * que hace un atardecer de verdad: el color entra por abajo.
   */
  const neutro = useMemo(() => new THREE.Color(ap.fondo), [ap])
  const baseCenit = useMemo(() => new THREE.Color(ap.cenit), [ap])
  const baseHorizonte = useMemo(() => new THREE.Color(ap.horizonte), [ap])
  const tinte = useMemo(() => new THREE.Color(), [])

  useFrame(() => {
    const m = malla.current
    if (!m) return

    if (scene.background instanceof THREE.Color) {
      tinte.copy(scene.background).sub(neutro)
    } else {
      tinte.setRGB(0, 0, 0)
    }

    // THREE.Color no tiene addScaledVector: se suma componente a componente.
    const cenit = material.uniforms.uCenit.value as THREE.Color
    cenit.setRGB(
      baseCenit.r + tinte.r * 0.8,
      baseCenit.g + tinte.g * 0.8,
      baseCenit.b + tinte.b * 0.8,
    )
    const horizonte = material.uniforms.uHorizonte.value as THREE.Color
    horizonte.setRGB(
      baseHorizonte.r + tinte.r * 1.25,
      baseHorizonte.g + tinte.g * 1.25,
      baseHorizonte.b + tinte.b * 1.25,
    )
  })

  return (
    <mesh
      ref={malla}
      material={material}
      renderOrder={-1000}
      /*
       * Sin descarte por frustum: la esfera envolvente se calcula una vez
       * en el origen local y esta malla se mueve a mano cada cuadro. Es el
       * mismo motivo por el que Journey y FallingFruit lo apagan.
       */
      frustumCulled={false}
      /*
       * Anclado al ojo en onBeforeRender y NO en un useFrame, y la
       * diferencia importa: three llama a onBeforeRender y recién después
       * calcula modelViewMatrix con la matriz del objeto, así que la
       * posición es la definitiva de ESE dibujo. Con un useFrame el cielo
       * podría quedar un cuadro atrasado respecto de la cámara, y en una
       * malla pegada al ojo un cuadro de atraso es un tirón visible.
       */
      onBeforeRender={(_r, _s, camara) => {
        const m = malla.current
        if (m) m.position.copy(camara.position)
      }}
    >
      <cylinderGeometry args={[1, 1, ALTO, 64, 1, true]} />
    </mesh>
  )
}
