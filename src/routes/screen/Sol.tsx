import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'

/**
 * Un amanecer que cada tanto pasa por detrás del árbol.
 *
 * PROTOTIPO, rama `animales`. El pedido fue "que salga el sol e ilumine",
 * pero acá "iluminar" no puede ser una luz de three: los materiales del
 * árbol son shaders propios sin iluminación, y una DirectionalLight no
 * mueve un solo píxel. Lo que sí existe en esta escena son dos cosas, y el
 * amanecer se construye con las dos:
 *
 *  · un DISCO de sol: dos sprites con la textura de glow —un núcleo chico
 *    intenso y un halo grande suave— que suben en arco;
 *  · el CIELO: el fondo y la niebla de la escena se funden hacia tonos de
 *    amanecer mientras el sol está alto, y vuelven exactamente a donde
 *    estaban cuando baja. Eso es lo que el ojo lee como "se iluminó todo".
 *
 * POR QUÉ SALE POR DETRÁS. A contraluz el árbol queda en silueta contra el
 * cielo tibio y se ve hermoso; por delante el disco taparía las hojas, que
 * son las ideas de los vecinos, y eso no se negocia. El azimut se calcula
 * al arrancar el evento: el lado opuesto a donde está la cámara en ese
 * momento. La cámara orbita despacio, así que en los ~45 segundos del
 * evento se corre un poco, pero nunca lo suficiente para que el sol quede
 * de frente.
 *
 * Y NO USA NINGÚN COLOR DE ÁREA. El dorado-durazno pálido del disco y los
 * violetas apagados del cielo quedan lejos del amarillo de Tecnología y del
 * naranja de Cultura: acá el color saturado significa "de qué habla una
 * idea", y el amanecer no habla de nada, solo acompaña.
 *
 * La instalación es nocturna y el resto de los elementos está calibrado
 * sobre fondo oscuro, así que el máximo del fundido sigue siendo de noche:
 * un cielo que se entibia, no un mediodía.
 */

/** Cada cuánto amanece, en segundos. Entre estos dos valores, al azar. */
const ESPERA_MIN = 150
const ESPERA_MAX = 240

/** El amanecer entero: nace, sube, se sostiene y baja. */
const DURACION_S = 45

/** Dorado-durazno pálido: ni el amarillo de Tecnología ni el naranja de Cultura. */
const COLOR_HALO = '#ffd9a0'
const COLOR_NUCLEO = '#fff3dc'

/**
 * A dónde llega el cielo con el sol en lo más alto. Partiendo del fondo
 * #050a12 y la niebla #071220, estos violetas con horizonte cálido se
 * sienten amanecer sin dejar de ser de noche.
 */
const CIELO_FONDO = '#241a2e'
const CIELO_NIEBLA = '#3a2438'

/**
 * Distancia del disco al eje del árbol, en unidades de modelo. La copa
 * llega a ~6.6 de alto y unas ~4 de radio: a 9.5 el sol queda claramente
 * detrás del follaje sin irse tan lejos que la niebla se lo coma.
 */
const RADIO = 9.5

/** Cuánto sube el disco en lo más alto del arco. */
const ALTO = 4.9

/** Deriva lateral del arco: el sol no sube en ascensor, cruza el cielo. */
const ANCHO = 3.2

/** Apenas bajo el horizonte al nacer y al morir, para que asome y se hunda. */
const HUNDIDO = 0.4

const suave = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/**
 * Progreso del evento (0..1) → posición angular en el arco (0..1), con una
 * meseta en el medio: el sol sube, SE SOSTIENE un momento en lo alto y
 * recién entonces baja. Sin la meseta el momento lindo —árbol en silueta,
 * cielo tibio— dura un suspiro. El suavizado en cada tramo evita el
 * quiebre de velocidad al entrar y salir de la pausa.
 */
function arcoDe(p: number): number {
  const FIN_SUBIDA = 0.42
  const FIN_PAUSA = 0.58
  if (p < FIN_SUBIDA) return 0.5 * suave(p / FIN_SUBIDA)
  if (p < FIN_PAUSA) return 0.5
  return 0.5 + 0.5 * suave((p - FIN_PAUSA) / (1 - FIN_PAUSA))
}

interface Amanecer {
  /** Azimut del sol, fijado al arrancar: el lado opuesto a la cámara. */
  az: number
  p: number
}

export default function Sol() {
  const grupo = useRef<THREE.Group>(null)
  const halo = useRef<THREE.Sprite>(null)
  const nucleo = useRef<THREE.Sprite>(null)
  const { camera, scene } = useThree()

  const glow = useMemo(() => getGlowTexture(), [])

  const materialHalo = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(COLOR_HALO),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [glow],
  )

  const materialNucleo = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(COLOR_NUCLEO),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [glow],
  )

  const evento = useRef<Amanecer | null>(null)
  const espera = useRef(50)
  const congelado = useRef(false)

  /*
   * Los colores base del cielo, capturados al ARRANCAR cada evento y no al
   * montar: el fondo sigue al tema (claro/oscuro) y puede haber cambiado
   * entre un amanecer y el siguiente. Se clonan una sola vez por evento y
   * al terminar se devuelven exactos, sin acumular error de lerp.
   */
  const baseFondo = useRef<THREE.Color | null>(null)
  const baseNiebla = useRef<THREE.Color | null>(null)

  // Temporales reutilizados: nada de esto puede crear objetos por cuadro.
  const posicion = useMemo(() => new THREE.Vector3(), [])
  const radial = useMemo(() => new THREE.Vector3(), [])
  const perpendicular = useMemo(() => new THREE.Vector3(), [])
  const cieloFondo = useMemo(() => new THREE.Color(CIELO_FONDO), [])
  const cieloNiebla = useMemo(() => new THREE.Color(CIELO_NIEBLA), [])

  const arrancar = () => {
    /*
     * Del lado opuesto a la cámara, calculado ahora. El grupo del árbol no
     * rota y su escala es uniforme, así que el azimut en mundo y en local
     * coinciden (mismo razonamiento que la ardilla, dado vuelta).
     */
    const az = Math.atan2(camera.position.x, camera.position.z) + Math.PI

    // scene.background acá es un THREE.Color, pero puede ser null o una
    // textura si alguien cambia la escena: en ese caso el cielo no se toca
    // y queda solo el disco, que igual se sostiene por sí mismo.
    baseFondo.current =
      scene.background instanceof THREE.Color ? scene.background.clone() : null
    baseNiebla.current = scene.fog ? scene.fog.color.clone() : null

    evento.current = { az, p: 0 }
  }

  const terminar = () => {
    // Devolución EXACTA: copy del clon, no confiar en que el lerp llegó.
    if (baseFondo.current && scene.background instanceof THREE.Color) {
      scene.background.copy(baseFondo.current)
    }
    if (baseNiebla.current && scene.fog) {
      scene.fog.color.copy(baseNiebla.current)
    }
    baseFondo.current = null
    baseNiebla.current = null
    evento.current = null
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      amanecer: arrancar,
      /** Congela el amanecer en un progreso 0..1 (0.5 = sol en lo más alto). */
      posar: (p = 0.5) => {
        arrancar()
        if (evento.current) evento.current.p = Math.min(0.99, Math.max(0, p))
        congelado.current = true
      },
      soltar: () => {
        congelado.current = false
      },
    }
    ;(window as unknown as { __arbolia_sol?: typeof api }).__arbolia_sol = api
    return () => {
      delete (window as unknown as { __arbolia_sol?: typeof api }).__arbolia_sol
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Si el componente se desmonta a mitad de un amanecer, el cielo no puede
  // quedar teñido: nadie más sabría devolverlo.
  useEffect(() => {
    return () => {
      if (evento.current) terminar()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, delta) => {
    const g = grupo.current
    if (!g) return

    const paso = Math.min(delta, 0.05)

    if (!evento.current) {
      g.visible = false
      espera.current -= paso
      if (espera.current <= 0) arrancar()
      return
    }

    const v = evento.current
    if (!congelado.current) v.p += paso / DURACION_S

    if (v.p >= 1) {
      terminar()
      espera.current = ESPERA_MIN + Math.random() * (ESPERA_MAX - ESPERA_MIN)
      g.visible = false
      return
    }

    g.visible = true

    /*
     * El arco. theta va de 0 a PI: nace de un lado del eje trasero, culmina
     * exactamente detrás del árbol y se hunde del otro lado, como un sol
     * de verdad visto en cámara rápida.
     */
    const theta = arcoDe(v.p) * Math.PI
    const altura = Math.sin(theta)

    radial.set(Math.sin(v.az), 0, Math.cos(v.az))
    perpendicular.set(Math.cos(v.az), 0, -Math.sin(v.az))

    posicion.copy(radial).multiplyScalar(RADIO)
    posicion.addScaledVector(perpendicular, Math.cos(theta) * ANCHO)
    posicion.y = altura * ALTO - HUNDIDO
    g.position.copy(posicion)

    /*
     * Todo sigue a la altura del sol: cuanto más alto, más grande el disco,
     * más opaco el glow y más teñido el cielo. El borde de entrada/salida
     * mata cualquier "pop" si el evento arranca o corta con el sol visible.
     */
    const borde = clamp01(Math.min(v.p, 1 - v.p) / 0.08)
    const brillo = suave(altura) * borde

    materialHalo.opacity = 0.55 * brillo
    materialNucleo.opacity = 0.9 * brillo

    if (halo.current) halo.current.scale.setScalar(3.4 + altura * 3.2)
    if (nucleo.current) nucleo.current.scale.setScalar(0.9 + altura * 0.7)

    /*
     * El cielo. No se lerpea "hacia" el objetivo acumulando cuadro a cuadro:
     * se reconstruye desde el color base capturado, así el tinte es función
     * pura de la altura del sol y al volver a cero el cielo ES el base.
     */
    if (baseFondo.current && scene.background instanceof THREE.Color) {
      scene.background.copy(baseFondo.current).lerp(cieloFondo, brillo)
    }
    if (baseNiebla.current && scene.fog) {
      scene.fog.color.copy(baseNiebla.current).lerp(cieloNiebla, brillo)
    }
  })

  return (
    <group ref={grupo} name="sol" visible={false}>
      <sprite ref={halo} material={materialHalo} scale={3.4} />
      <sprite ref={nucleo} material={materialNucleo} scale={0.9} />
    </group>
  )
}
