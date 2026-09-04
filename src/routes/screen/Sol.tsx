import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'
import { astro } from './atardecer'

/**
 * Un astro que cada tanto pasa por detrás del árbol: sol chico con el tema
 * claro, luna con el oscuro.
 *
 * PROTOTIPO, rama `animales`. El pedido original fue "que salga el sol e
 * ilumine", pero acá "iluminar" no puede ser una luz de three: los
 * materiales del árbol son shaders propios sin iluminación, y una
 * DirectionalLight no mueve un solo píxel. Lo que sí existe en esta escena
 * son dos cosas, y el paso del astro se construye con las dos:
 *
 *  · un DISCO: dos sprites con la textura de glow —un núcleo chico intenso
 *    y un halo suave apenas mayor— que suben en arco. Chicos a propósito:
 *    un astro lejano se lee astro, un disco gigante se lee reflector;
 *  · el CIELO: el fondo y la niebla de la escena se funden hacia los tonos
 *    del tema activo mientras el astro está alto, y vuelven exactamente a
 *    donde estaban cuando baja. Eso es lo que el ojo lee como "cambió la
 *    luz".
 *
 * POR QUÉ DOS ASTROS. En oscuro el fondo es #050a12 y el glow aditivo
 * funciona: la luna va con núcleo frío y halo plateado-azulado aditivos, y
 * el cielo se levanta apenas hacia una noche de luna —la noche sigue siendo
 * noche—. En claro el fondo es #f7fafd casi blanco y el aditivo NO EXISTE
 * físicamente (sumar luz sobre blanco da blanco): el sol chico va con
 * blending normal y tintas doradas, y el cielo se corre hacia un día dorado
 * suave. Si el tema cambia a mitad de un paso no hace falta nada especial:
 * el cielo base sale de la tabla CIELO del tema activo, así que en el
 * cuadro siguiente ya es el que corresponde, con el astro donde estaba.
 *
 * POR QUÉ SALE POR DETRÁS. A contraluz el árbol queda en silueta contra el
 * cielo teñido y se ve hermoso; por delante el disco taparía las hojas, que
 * son las ideas de los vecinos, y eso no se negocia. El azimut se calcula
 * al arrancar el evento: el lado opuesto a donde está la cámara en ese
 * momento. La cámara orbita despacio, así que en los ~45 segundos del
 * evento se corre un poco, pero nunca lo suficiente para que el astro quede
 * de frente.
 *
 * Y NO USA NINGÚN COLOR DE ÁREA. El dorado apagado del sol y el plateado
 * pálido de la luna quedan lejos del amarillo de Tecnología y del naranja
 * de Cultura: acá el color saturado significa "de qué habla una idea", y el
 * astro no habla de nada, solo acompaña.
 */

/** Cada cuánto pasa el astro, en segundos. Entre estos dos valores, al azar. */
const ESPERA_MIN = 120
const ESPERA_MAX = 200

/** El paso entero: nace, sube, se sostiene y baja. */
const DURACION_S = 45

/**
 * Apariencia por tema. Todo lo que distingue a la luna del sol chico vive
 * acá: colores del disco, opacidades máximas, el blending (aditivo solo
 * donde físicamente existe) y a dónde llega el cielo con el astro en lo más
 * alto. Las opacidades son las CONSTANTES BASE del fundido del useFrame:
 * salen de acá y no de números sueltos, para que el fundido funcione igual
 * en los dos temas.
 */
const APARIENCIA = {
  oscuro: {
    // LUNA: núcleo frío y halo plateado-azulado, aditivos como siempre.
    // El cielo parte de #050a12/#071220 y va apenas hacia una noche de
    // luna: un levantón sutil, no un amanecer violeta.
    nucleo: '#eef4ff',
    halo: '#bcd2ff',
    opacidadNucleo: 0.85,
    opacidadHalo: 0.3,
    blending: THREE.AdditiveBlending,
    cieloFondo: '#0d1626',
    cieloNiebla: '#13203a',
  },
  claro: {
    // SOL chico: sobre el fondo casi blanco el aditivo no existe, así que
    // va blending normal con tintas doradas. El cielo se corre hacia un
    // día dorado suave.
    nucleo: '#eda23f',
    halo: '#f4c47c',
    opacidadNucleo: 0.95,
    opacidadHalo: 0.55,
    blending: THREE.NormalBlending,
    cieloFondo: '#fdf0da',
    cieloNiebla: '#f3e3c8',
  },
} as const

/**
 * Distancia del disco al eje del árbol, en unidades de modelo. La copa
 * llega a ~6.6 de alto y unas ~4 de radio: a 9.5 el astro queda claramente
 * detrás del follaje sin irse tan lejos que quede fuera de cuadro.
 */
const RADIO = 9.5

/**
 * Cuánto sube el disco en lo más alto del arco. Tiene que SUPERAR la copa
 * (~6.6): con 4.9 el astro culminaba adentro del follaje y la luna era una
 * mancha detrás de las ramas en vez de un disco en el cielo.
 */
const ALTO = 7.6

/** Deriva lateral del arco: el astro no sube en ascensor, cruza el cielo. */
const ANCHO = 3.2

/** Apenas bajo el horizonte al nacer y al morir, para que asome y se hunda. */
const HUNDIDO = 0.4

const suave = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/**
 * Progreso del evento (0..1) → posición angular en el arco (0..1), con una
 * meseta en el medio: el astro sube, SE SOSTIENE un momento en lo alto y
 * recién entonces baja. Sin la meseta el momento lindo —árbol en silueta,
 * cielo teñido— dura un suspiro. El suavizado en cada tramo evita el
 * quiebre de velocidad al entrar y salir de la pausa.
 */
function arcoDe(p: number): number {
  const FIN_SUBIDA = 0.42
  const FIN_PAUSA = 0.58
  if (p < FIN_SUBIDA) return 0.5 * suave(p / FIN_SUBIDA)
  if (p < FIN_PAUSA) return 0.5
  return 0.5 + 0.5 * suave((p - FIN_PAUSA) / (1 - FIN_PAUSA))
}

interface PasoDeAstro {
  /** Azimut del astro, fijado al arrancar: el lado opuesto a la cámara. */
  az: number
  p: number
}

export default function Sol({ tema = 'oscuro' }: { tema?: 'claro' | 'oscuro' }) {
  const grupo = useRef<THREE.Group>(null)
  const halo = useRef<THREE.Sprite>(null)
  const nucleo = useRef<THREE.Sprite>(null)
  const { camera } = useThree()

  const ap = APARIENCIA[tema]

  const glow = useMemo(() => getGlowTexture(), [])

  const materialHalo = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(ap.halo),
        transparent: true,
        opacity: 0,
        blending: ap.blending,
        depthWrite: false,
        toneMapped: false,
        // Sin niebla: el astro vive en el cielo, no a 18 unidades de la
        // camara. Con fog el disco chico se desvanecia hasta no leerse.
        fog: false,
      }),
    [glow, ap],
  )

  const materialNucleo = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(ap.nucleo),
        transparent: true,
        opacity: 0,
        blending: ap.blending,
        depthWrite: false,
        toneMapped: false,
        // Sin niebla: el astro vive en el cielo, no a 18 unidades de la
        // camara. Con fog el disco chico se desvanecia hasta no leerse.
        fog: false,
      }),
    [glow, ap],
  )

  const evento = useRef<PasoDeAstro | null>(null)
  const espera = useRef(40)
  const congelado = useRef(false)

  /*
   * El cielo base ya no vive acá.
   *
   * Este componente capturaba scene.background al arrancar cada paso para
   * poder devolverlo al terminar, y eso traía un bug largo: si el operador
   * cambiaba de tema con el astro arriba, al terminar restauraba el cielo
   * del tema VIEJO encima del nuevo. Ahora Sol no lee ni escribe el cielo:
   * publica su tinte en atardecer.ts y el director lo compone sobre el
   * fondo de la fase. Un solo escritor, y nada que restaurar.
   */

  // Temporales reutilizados: nada de esto puede crear objetos por cuadro.
  // Los objetivos del cielo se rehacen solo cuando cambia el tema.
  const posicion = useMemo(() => new THREE.Vector3(), [])
  const radial = useMemo(() => new THREE.Vector3(), [])
  const perpendicular = useMemo(() => new THREE.Vector3(), [])
  const cieloFondo = useMemo(() => new THREE.Color(ap.cieloFondo), [ap])
  const cieloNiebla = useMemo(() => new THREE.Color(ap.cieloNiebla), [ap])

  const arrancar = () => {
    /*
     * Del lado opuesto a la cámara, calculado ahora. El grupo del árbol no
     * rota y su escala es uniforme, así que el azimut en mundo y en local
     * coinciden (mismo razonamiento que la ardilla, dado vuelta).
     */
    const az = Math.atan2(camera.position.x, camera.position.z) + Math.PI

    evento.current = { az, p: 0 }
  }

  const terminar = () => {
    /*
     * Ya no se restaura nada: se apaga el tinte y listo.
     *
     * Antes acá se devolvía scene.background y scene.fog a mano, y ese era
     * el origen de un bug largo —restaurar el cielo del tema viejo encima
     * del nuevo—. Publicando el tinte, el cielo lo compone el director del
     * atardecer a partir de la fase, así que apagar el astro es poner su
     * brillo en cero y no tocar la escena.
     */
    astro.brillo = 0
    evento.current = null
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      /** Arranca un paso ya. El nombre queda por costumbre: en tema oscuro lo que sale es la luna. */
      amanecer: arrancar,
      /** Congela el paso en un progreso 0..1 (0.5 = astro en lo más alto). */
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

  // Si el componente se desmonta a mitad de un paso, el cielo no puede
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
     * exactamente detrás del árbol y se hunde del otro lado, como un astro
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
     * Todo sigue a la altura del astro: cuanto más alto, apenas más grande
     * el disco, más opaco y más teñido el cielo. Las opacidades base salen
     * de la apariencia del tema activo. El borde de entrada/salida mata
     * cualquier "pop" si el evento arranca o corta con el astro visible.
     */
    const borde = clamp01(Math.min(v.p, 1 - v.p) / 0.08)
    const brillo = suave(altura) * borde

    materialHalo.opacity = ap.opacidadHalo * brillo
    materialNucleo.opacity = ap.opacidadNucleo * brillo

    if (halo.current) halo.current.scale.setScalar(1.3 + altura * 0.9)
    if (nucleo.current) nucleo.current.scale.setScalar(0.45 + altura * 0.25)

    /*
     * El cielo. No se lerpea "hacia" el objetivo acumulando cuadro a cuadro:
     * se reconstruye desde el color base capturado, así el tinte es función
     * pura de la altura del astro y al volver a cero el cielo ES el base.
     */
    /*
     * El cielo NO se escribe acá: se publica hacia dónde tira el astro y
     * con cuánta fuerza. El director del atardecer lo compone sobre el
     * fondo de la fase. Ver atardecer.ts.
     */
    astro.brillo = brillo
    astro.fondo.copy(cieloFondo)
    astro.niebla.copy(cieloNiebla)
  })

  return (
    <group ref={grupo} name="sol" visible={false}>
      <sprite ref={halo} material={materialHalo} scale={1.3} />
      <sprite ref={nucleo} material={materialNucleo} scale={0.45} />
    </group>
  )
}
