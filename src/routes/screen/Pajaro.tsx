import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'

/**
 * Un pájaro de luz que cruza el árbol cada tanto.
 *
 * PROTOTIPO, en la rama `animales`. La pregunta que vino a contestar era si
 * la placa integrada del stand lo aguanta. La respuesta ya se sabía por
 * medición: la escena está limitada por relleno de píxeles, no por
 * geometría —pasar de 8.800 a 18.627 hojas casi no movió el cuadro— así que
 * catorce triángulos más no se notan. Lo caro nunca fue esto.
 *
 * POR QUÉ ES DE LUZ Y NO UN PÁJARO.
 *
 * En esta instalación todo lo que brilla es una persona: cada hoja es la
 * idea de alguien. Meter un animal con textura introduce un segundo idioma
 * visual en una pantalla que tiene uno solo. Hecho de luz, con la misma
 * materia que el árbol, suma vida sin contradecir nada.
 *
 * Y NO USA NINGÚN COLOR DE ÁREA. Los ocho colores del árbol significan algo
 * —de qué habla la idea— y si el pájaro fuera verde ambiente o azul
 * movilidad, de lejos se leería como una hoja suelta volando. Va en un
 * blanco celeste que no pertenece a ninguna categoría.
 *
 * DÓNDE VUELA. Alto y por afuera de la copa, nunca a través. El momento que
 * importa en esta pantalla es la hoja de un vecino brotando mientras esa
 * persona está parada mirando, y el movimiento es el imán de atención más
 * fuerte que existe: si el pájaro cruza por el medio justo entonces, le robó
 * el momento.
 */

/** Cada cuánto aparece, en segundos. Entre estos dos valores, al azar. */
const ESPERA_MIN = 22
const ESPERA_MAX = 38

/** Lo que tarda en cruzar. */
const CRUCE_S = 7.5

/** Aleteos por segundo. */
const ALETEO_HZ = 5.5

/** Blanco celeste: no es el color de ninguna de las ocho áreas. */
const COLOR = '#bfe9ff'

/**
 * Tamaño del pájaro entero.
 *
 * La primera versión medía unos 26 px en el LED de 1080 y se leía como un
 * destello, no como un pájaro: la silueta necesita ancho para que el ojo
 * reconozca las alas. Medido en pantalla, no estimado.
 */
const TAMANO = 2.4

/**
 * Cuerpo: un dardo de cuatro caras, ocho triángulos.
 *
 * Se construye a mano y no con ConeGeometry porque hace falta que la punta
 * mire al eje -Z, que es hacia donde se orienta el objeto al seguir la
 * tangente de la curva.
 */
function crearCuerpo(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.045, 0.26, 4)
  // El cono nace apuntando a +Y; se lo acuesta para que apunte a -Z.
  geo.rotateX(-Math.PI / 2)
  return geo
}

/**
 * Ala flechada hacia atrás, dos triángulos, visible de los dos lados.
 *
 * La primera versión era un solo triángulo con la punta al costado, y en
 * pantalla no se leía como un pájaro sino como un avioncito de papel: un ala
 * perpendicular al cuerpo es la silueta de un dardo. Flechada —la punta
 * bastante más atrás que la raíz— el ojo la reconoce enseguida, que es lo
 * mismo que hace una gaviota vista de lejos.
 */
function crearAla(lado: 1 | -1): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const raizAdelante = [0, 0, -0.05]
  const raizAtras = [0, 0, 0.09]
  const codo = [lado * 0.22, 0.01, 0.06]
  const punta = [lado * 0.44, 0.03, 0.26]

  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        ...raizAdelante, ...raizAtras, ...codo,
        ...raizAdelante, ...codo, ...punta,
      ],
      3,
    ),
  )
  geo.computeVertexNormals()
  return geo
}

/** Cola ahorquillada: dos triangulitos que cierran la silueta por detrás. */
function crearCola(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0.10, -0.02, 0, 0.10, -0.09, 0.01, 0.30,
        0, 0, 0.10, 0.02, 0, 0.10, 0.09, 0.01, 0.30,
      ],
      3,
    ),
  )
  geo.computeVertexNormals()
  return geo
}

/**
 * Un recorrido nuevo: entra por un costado, cruza en arco y sale por el otro.
 *
 * Las alturas y profundidades salen al azar dentro de un rango que deja el
 * vuelo por encima de la copa —que llega a unos 6.6 en unidades de modelo— y
 * lo suficientemente lejos como para que no atraviese follaje.
 */
function crearRuta(): THREE.CatmullRomCurve3 {
  const lado = Math.random() < 0.5 ? 1 : -1
  const altura = 4.8 + Math.random() * 2.6
  const desnivel = (Math.random() - 0.5) * 1.4
  const z = (Math.random() - 0.5) * 5
  const combado = 0.7 + Math.random() * 1.1

  return new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(lado * 11, altura, z - lado * 2),
      new THREE.Vector3(lado * 5.5, altura + combado * 0.5, z),
      new THREE.Vector3(0, altura + combado, z + lado * 1.2),
      new THREE.Vector3(-lado * 5.5, altura + combado * 0.4 + desnivel, z),
      new THREE.Vector3(-lado * 11, altura + desnivel, z + lado * 2),
    ],
    false,
    'catmullrom',
    0.5,
  )
}

export default function Pajaro() {
  const grupo = useRef<THREE.Group>(null)
  const alaIzq = useRef<THREE.Mesh>(null)
  const alaDer = useRef<THREE.Mesh>(null)
  const estela = useRef<THREE.Sprite>(null)

  const glow = useMemo(() => getGlowTexture(), [])
  const cuerpoGeo = useMemo(crearCuerpo, [])
  const alaIzqGeo = useMemo(() => crearAla(1), [])
  const alaDerGeo = useMemo(() => crearAla(-1), [])
  const colaGeo = useMemo(crearCola, [])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR),
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Sin mapeo de tonos: así el bloom lo agarra igual que al árbol.
        toneMapped: false,
      }),
    [],
  )

  const materialEstela = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: new THREE.Color(COLOR),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [glow],
  )

  /** null = escondido, esperando el próximo turno. */
  const vuelo = useRef<{ ruta: THREE.CatmullRomCurve3; t: number } | null>(null)
  const espera = useRef(6)
  const reloj = useRef(0)
  /** Sólo desarrollo: detiene el avance para poder medir. */
  const congelado = useRef(false)

  const despegar = () => {
    vuelo.current = { ruta: crearRuta(), t: 0 }
  }

  /*
   * Disparador manual para probarlo sin esperar medio minuto. Sólo en
   * desarrollo, igual que el resto del puente de ensayo.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      volar: despegar,
      /*
       * Lo deja congelado en un punto del recorrido, con 0.5 en el medio del
       * cuadro. Existe para poder MEDIRLO: con los cuadros forzados de la
       * herramienta de diagnóstico el vuelo casi no avanza, así que el
       * pájaro se queda fuera de cuadro y una medición diría que no cuesta
       * nada por el motivo equivocado.
       */
      posar: (t = 0.5) => {
        vuelo.current = { ruta: crearRuta(), t: Math.min(0.99, Math.max(0.01, t)) }
        congelado.current = true
      },
      soltar: () => {
        congelado.current = false
      },
    }
    ;(window as unknown as { __arbolia_pajaro?: typeof api }).__arbolia_pajaro = api
    return () => {
      delete (window as unknown as { __arbolia_pajaro?: typeof api }).__arbolia_pajaro
    }
  }, [])

  useFrame((_, delta) => {
    const g = grupo.current
    if (!g) return

    const paso = Math.min(delta, 0.05)
    reloj.current += paso

    if (!vuelo.current) {
      g.visible = false
      espera.current -= paso
      if (espera.current <= 0) despegar()
      return
    }

    const v = vuelo.current
    if (!congelado.current) v.t += paso / CRUCE_S

    if (v.t >= 1) {
      vuelo.current = null
      espera.current = ESPERA_MIN + Math.random() * (ESPERA_MAX - ESPERA_MIN)
      g.visible = false
      return
    }

    g.visible = true

    const punto = v.ruta.getPointAt(v.t)
    const tangente = v.ruta.getTangentAt(v.t)
    g.position.copy(punto)

    // Mira hacia donde va. El cuerpo se construyó apuntando a -Z, que es lo
    // que lookAt pone sobre el objetivo.
    g.lookAt(punto.clone().add(tangente))

    /*
     * Entra y sale con transparencia en vez de aparecer de golpe. Los
     * extremos de la ruta ya están fuera de cuadro, pero el fundido evita
     * el parpadeo si alguna vez se acorta el recorrido.
     */
    const borde = Math.min(v.t, 1 - v.t) / 0.12
    const opacidad = Math.min(1, borde)
    material.opacity = 0.92 * opacidad
    materialEstela.opacity = 0.5 * opacidad

    // Aleteo. Las dos alas suben y bajan juntas.
    const angulo = Math.sin(reloj.current * ALETEO_HZ * Math.PI * 2) * 0.62
    if (alaIzq.current) alaIzq.current.rotation.z = angulo
    if (alaDer.current) alaDer.current.rotation.z = -angulo

    // El halo late apenas con el aleteo: da sensación de esfuerzo.
    if (estela.current) {
      const s = 0.5 + Math.abs(angulo) * 0.22
      estela.current.scale.setScalar(s)
    }
  })

  return (
    <group ref={grupo} name="pajaro" scale={TAMANO} visible={false}>
      <mesh geometry={cuerpoGeo} material={material} />
      <mesh ref={alaIzq} geometry={alaIzqGeo} material={material} />
      <mesh ref={alaDer} geometry={alaDerGeo} material={material} />
      <mesh geometry={colaGeo} material={material} />
      <sprite ref={estela} material={materialEstela} scale={0.5} />
    </group>
  )
}
