import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'

/**
 * Una bandada de pájaros de luz que cruzan el árbol cada tanto.
 *
 * PROTOTIPO, en la rama `animales`. El pájaro original vino a contestar si
 * la placa integrada del stand lo aguanta, y la respuesta ya se sabía por
 * medición: la escena está limitada por relleno de píxeles, no por
 * geometría —pasar de 8.800 a 18.627 hojas casi no movió el cuadro— así que
 * cuatro pájaros de catorce triángulos tampoco se notan. Lo caro nunca fue
 * esto.
 *
 * POR QUÉ SON DE LUZ Y NO PÁJAROS.
 *
 * En esta instalación todo lo que brilla es una persona: cada hoja es la
 * idea de alguien. Meter un animal con textura introduce un segundo idioma
 * visual en una pantalla que tiene uno solo. Hechos de luz, con la misma
 * materia que el árbol, suman vida sin contradecir nada.
 *
 * Y NO USAN NINGÚN COLOR DE ÁREA. Los ocho colores del árbol significan algo
 * —de qué habla la idea— y un pájaro verde ambiente o azul movilidad, de
 * lejos, se leería como una hoja suelta volando. La bandada va en tonos tan
 * pálidos y desaturados que ninguno pertenece a ninguna categoría: de cerca
 * se nota que son distintos entre sí, de lejos son todos "luz".
 *
 * DOS TEMAS, DOS MATERIAS. En oscuro los pájaros son luz aditiva, la misma
 * materia que el árbol sobre el fondo profundo. En claro el fondo es casi
 * blanco y el aditivo deja de existir físicamente —sumar luz sobre blanco da
 * blanco—, así que la bandada pasa a tinta: los mismos cuatro tonos pero en
 * versión apagada, con mezcla normal y opacidad alta. La estela de glow, que
 * es puro brillo aditivo, en claro directamente se apaga: un halo sobre
 * blanco no es tenue, es invisible.
 *
 * DÓNDE VUELAN. Alto y por afuera de la copa, nunca a través. El momento que
 * importa en esta pantalla es la hoja de un vecino brotando mientras esa
 * persona está parada mirando, y el movimiento es el imán de atención más
 * fuerte que existe: si un pájaro cruza por el medio justo entonces, le robó
 * el momento. Por lo mismo los calendarios de espera están corridos entre
 * sí: lo normal es ver un pájaro cada tanto, y muy de vez en cuando dos que
 * coinciden. Cuatro cruzando juntos todo el tiempo dejaría de ser un detalle
 * y pasaría a ser el espectáculo.
 */

/**
 * Tamaño de referencia del pájaro entero; cada uno lo multiplica por su
 * escala propia.
 *
 * La primera versión medía unos 26 px en el LED de 1080 y se leía como un
 * destello, no como un pájaro: la silueta necesita ancho para que el ojo
 * reconozca las alas. Medido en pantalla, no estimado.
 */
const TAMANO_BASE = 2.4

interface ConfigPajaro {
  /**
   * Un tono por tema, siempre lejos de los ocho colores de área. En oscuro
   * pálido y desaturado; en claro la versión tinta del mismo tono.
   */
  color: { oscuro: string; claro: string }
  /** Multiplica TAMANO_BASE: la variedad de tamaños vende "bandada". */
  escala: number
  /** Lo que tarda en cruzar, en segundos. */
  cruceS: number
  /**
   * Aleteos por segundo. El original estaba en 5.5 y se veía nervioso: a esa
   * frecuencia, sobre una pantalla quieta y contemplativa, el ojo lee
   * agitación en vez de vuelo. Un ave grande planeando bate mucho más lento.
   * Alrededor de 2.8 Hz, con una variación chica por pájaro para que las
   * alas no batan todas en fase.
   */
  aleteoHz: number
  /** Ventana de espera entre cruces, en segundos. */
  esperaMin: number
  esperaMax: number
  /** Primera espera al montar: escalona los debuts para que no salgan juntos. */
  esperaInicial: number
}

/*
 * La bandada. Las esperas bajaron ~30% respecto de la primera versión: en el
 * stand pasaban minutos enteros sin un solo cruce y el detalle no existía.
 * Los rangos siguen siendo deliberadamente distintos entre sí y corridos
 * para no calzar en múltiplos: con ventanas parejas los pájaros terminan
 * sincronizándose por casualidad y quedan cruzando en pelotón. Así, los
 * encuentros de a dos existen pero son la excepción.
 */
const BANDADA: ConfigPajaro[] = [
  // El celeste original, el "primero" de la bandada: es el que posa() congela.
  { color: { oscuro: '#9fd8ff', claro: '#4f9bd6' }, escala: 1.0, cruceS: 7.5, aleteoHz: 2.8, esperaMin: 15, esperaMax: 27, esperaInicial: 4 },
  // Lavanda pálido / lavanda tinta: nada que ver con el violeta saturado de área.
  { color: { oscuro: '#c9baf5', claro: '#8f7fd6' }, escala: 0.85, cruceS: 6.2, aleteoHz: 3.1, esperaMin: 20, esperaMax: 33, esperaInicial: 10 },
  // Dorado pálido / ocre: el más grande y el más lento, planea.
  { color: { oscuro: '#ffe3a8', claro: '#c08d3e' }, escala: 1.2, cruceS: 8.8, aleteoHz: 2.5, esperaMin: 23, esperaMax: 39, esperaInicial: 17 },
  // Rosa muy lavado / rosa viejo: el rosa de área es mucho más saturado.
  { color: { oscuro: '#ffd2de', claro: '#cf7d97' }, escala: 0.9, cruceS: 6.8, aleteoHz: 2.9, esperaMin: 18, esperaMax: 30, esperaInicial: 25 },
]

/**
 * Vestuario por tema, aparte del color que ya viene en BANDADA.
 *
 * En oscuro todo es luz aditiva y translúcida, como el árbol. En claro el
 * aditivo no existe sobre un fondo casi blanco, así que se pasa a mezcla
 * normal con opacidad más alta —tinta, no brillo— y la estela queda en cero.
 * El fundido del useFrame multiplica estas bases, nunca constantes sueltas:
 * si multiplicara un 0.78 fijo, en claro el pájaro entraría en fantasma.
 */
const APARIENCIA: Record<'claro' | 'oscuro', {
  opacidad: number
  opacidadEstela: number
  blending: THREE.Blending
}> = {
  oscuro: { opacidad: 0.78, opacidadEstela: 0.35, blending: THREE.AdditiveBlending },
  claro: { opacidad: 0.85, opacidadEstela: 0, blending: THREE.NormalBlending },
}

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
 * Cabeza: una esfera chica adelantada sobre la punta del cuerpo.
 *
 * El dardo solo, de perfil, se leía como una flecha con alas; con una cabeza
 * el ojo completa "pájaro" sin pensarlo. Va fija al grupo y no a las alas:
 * si acompañara el aleteo, la silueta se rompería en cada batida.
 */
function crearCabeza(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.05, 10, 8)
  // Sobre la punta del cuerpo (el dardo llega a z = -0.13) y apenas arriba,
  // hacia -Z que es adonde apunta el vuelo.
  geo.translate(0, 0.02, -0.13)
  return geo
}

/**
 * Pico: un cono corto que remata la cabeza hacia -Z. Corto a propósito:
 * más largo, de lejos, el pájaro se vuelve mosquito.
 */
function crearPico(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.025, 0.06, 4)
  // Igual que el cuerpo: el cono nace apuntando a +Y y se lo acuesta a -Z.
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, 0.02, -0.2)
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

/** Lo que cada pájaro le presta al puente de desarrollo del padre. */
interface ControlesPajaro {
  /** Con retraso > 0 no despega ya: queda contando para salir escalonado. */
  volar: (retraso?: number) => void
  posar: (t: number) => void
  soltar: () => void
}

/** Las geometrías se arman una sola vez en el padre y se comparten. */
interface Geometrias {
  cuerpo: THREE.BufferGeometry
  cabeza: THREE.BufferGeometry
  pico: THREE.BufferGeometry
  alaIzq: THREE.BufferGeometry
  alaDer: THREE.BufferGeometry
  cola: THREE.BufferGeometry
  glow: THREE.Texture
}

function UnPajaro({
  config,
  geos,
  registro,
  indice,
  tema,
}: {
  config: ConfigPajaro
  geos: Geometrias
  registro: React.MutableRefObject<ControlesPajaro[]>
  indice: number
  tema: 'claro' | 'oscuro'
}) {
  const grupo = useRef<THREE.Group>(null)
  const alaIzq = useRef<THREE.Mesh>(null)
  const alaDer = useRef<THREE.Mesh>(null)
  const estela = useRef<THREE.Sprite>(null)

  // El vestuario del tema activo: bases de opacidad y modo de mezcla.
  const apariencia = APARIENCIA[tema]

  // Un material por pájaro: son cuatro, y cada uno anima su propia opacidad
  // en el fundido, así que compartirlo acoplaría los fundidos entre sí.
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(config.color[tema]),
        transparent: true,
        opacity: APARIENCIA[tema].opacidad,
        blending: APARIENCIA[tema].blending,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Sin mapeo de tonos: así el bloom lo agarra igual que al árbol, y
        // en claro la tinta queda del color exacto que se eligió.
        toneMapped: false,
      }),
    [config.color, tema],
  )

  /*
   * La estela queda aditiva en los dos temas: en claro su opacidad base es 0
   * y el sprite además se oculta, así que el modo de mezcla no importa.
   */
  const materialEstela = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: geos.glow,
        color: new THREE.Color(config.color[tema]),
        transparent: true,
        opacity: APARIENCIA[tema].opacidadEstela,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [geos.glow, config.color, tema],
  )

  /** null = escondido, esperando el próximo turno. */
  const vuelo = useRef<{ ruta: THREE.CatmullRomCurve3; t: number } | null>(null)
  const espera = useRef(config.esperaInicial)
  /*
   * El reloj arranca desfasado por pájaro: si dos llegan a cruzar juntos,
   * al menos que no batan las alas en espejo, que se ve coreografiado.
   */
  const reloj = useRef(indice * 1.7)
  /** Sólo desarrollo: detiene el avance para poder medir. */
  const congelado = useRef(false)

  // Temporales reutilizados: nada de esto puede crear objetos por cuadro.
  const punto = useMemo(() => new THREE.Vector3(), [])
  const tangente = useMemo(() => new THREE.Vector3(), [])
  const mira = useMemo(() => new THREE.Vector3(), [])

  const despegar = () => {
    vuelo.current = { ruta: crearRuta(), t: 0 }
  }

  /*
   * Se anota en el registro del padre, que es quien publica el puente de
   * desarrollo: acá no hay window ni nombre global, sólo los controles.
   */
  useEffect(() => {
    registro.current[indice] = {
      volar: (retraso = 0) => {
        if (retraso <= 0) {
          despegar()
        } else {
          // Cancela lo que hubiera y queda contando: es un disparador de
          // ensayo, la prolijidad del vuelo en curso no importa.
          vuelo.current = null
          espera.current = retraso
        }
      },
      posar: (t) => {
        vuelo.current = { ruta: crearRuta(), t: Math.min(0.99, Math.max(0.01, t)) }
        congelado.current = true
      },
      soltar: () => {
        congelado.current = false
      },
    }
    return () => {
      delete registro.current[indice]
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((estado, delta) => {
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
    if (!congelado.current) v.t += paso / config.cruceS

    if (v.t >= 1) {
      vuelo.current = null
      espera.current = config.esperaMin + Math.random() * (config.esperaMax - config.esperaMin)
      g.visible = false
      return
    }

    g.visible = true

    v.ruta.getPointAt(v.t, punto)
    v.ruta.getTangentAt(v.t, tangente)
    g.position.copy(punto)

    // Mira hacia donde va. El cuerpo se construyó apuntando a -Z, que es lo
    // que lookAt pone sobre el objetivo.
    mira.copy(punto).add(tangente)
    g.lookAt(mira)

    /*
     * Entra y sale con transparencia en vez de aparecer de golpe. Los
     * extremos de la ruta ya están fuera de cuadro, pero el fundido evita
     * el parpadeo si alguna vez se acorta el recorrido.
     */
    const borde = Math.min(v.t, 1 - v.t) / 0.12
    /*
     * Doble fundido: en los extremos de la ruta (entrada y salida) y por
     * CERCANIA A LA CAMARA. La ruta cruza por delante o por detras segun
     * donde este la camara orbitando, y un pajaro a tres unidades del lente
     * ocupa media pantalla: un flash blanco que roba toda la atencion. En
     * vez de esquivarlo con la ruta —imposible, la camara se mueve— se
     * desvanece al acercarse, como un ave que sale de foco.
     */
    const distCam = punto.distanceTo(estado.camera.position)
    const cerca = Math.min(1, Math.max(0, (distCam - 3.2) / 2.8))
    const opacidad = Math.min(1, borde) * cerca
    // Las bases salen del tema activo: el mismo fundido sirve para la luz
    // de oscuro y para la tinta de claro (donde la estela base ya es 0).
    material.opacity = apariencia.opacidad * opacidad
    materialEstela.opacity = apariencia.opacidadEstela * opacidad

    // Aleteo. Las dos alas suben y bajan juntas.
    const angulo = Math.sin(reloj.current * config.aleteoHz * Math.PI * 2) * 0.52
    if (alaIzq.current) alaIzq.current.rotation.z = angulo
    if (alaDer.current) alaDer.current.rotation.z = -angulo

    // El halo late apenas con el aleteo: da sensación de esfuerzo.
    if (estela.current) {
      const s = 0.5 + Math.abs(angulo) * 0.22
      estela.current.scale.setScalar(s)
    }
  })

  return (
    <group ref={grupo} name={`pajaro-${indice}`} scale={TAMANO_BASE * config.escala} visible={false}>
      <mesh geometry={geos.cuerpo} material={material} />
      {/* Cabeza y pico fijos al grupo, no a las alas: el aleteo no los mueve. */}
      <mesh geometry={geos.cabeza} material={material} />
      <mesh geometry={geos.pico} material={material} />
      <mesh ref={alaIzq} geometry={geos.alaIzq} material={material} />
      <mesh ref={alaDer} geometry={geos.alaDer} material={material} />
      <mesh geometry={geos.cola} material={material} />
      {/* En claro la estela ni se dibuja: glow aditivo sobre blanco no existe. */}
      <sprite ref={estela} material={materialEstela} scale={0.5} visible={tema === 'oscuro'} />
    </group>
  )
}

/**
 * El tema llega por prop desde TreeScene: acá no se lee el DOM ni se usa
 * useTema. El default 'oscuro' mantiene el aspecto histórico si nadie pasa
 * nada.
 */
export default function Pajaro({ tema = 'oscuro' }: { tema?: 'claro' | 'oscuro' }) {
  const geos = useMemo<Geometrias>(
    () => ({
      cuerpo: crearCuerpo(),
      cabeza: crearCabeza(),
      pico: crearPico(),
      alaIzq: crearAla(1),
      alaDer: crearAla(-1),
      cola: crearCola(),
      glow: getGlowTexture(),
    }),
    [],
  )

  /*
   * Cada UnPajaro deja acá sus controles al montarse. Los efectos de los
   * hijos corren antes que el del padre, así que cuando se publica el puente
   * el registro ya está completo.
   */
  const registro = useRef<ControlesPajaro[]>([])

  /*
   * Disparador manual para probarlos sin esperar medio minuto. Sólo en
   * desarrollo, igual que el resto del puente de ensayo.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      /*
       * La bandada entera, escalonada como saldría sola: entre 0 y 2.5 s de
       * un pájaro al siguiente. Todos juntos sería un ensayo de otra cosa.
       */
      volar: () => {
        let retraso = 0
        registro.current.forEach((c) => {
          c.volar(retraso)
          retraso += Math.random() * 2.5
        })
      },
      /*
       * Congela SOLO el primer pájaro —el celeste original— en un punto del
       * recorrido, con 0.5 en el medio del cuadro. Existe para poder
       * MEDIRLO: con los cuadros forzados de la herramienta de diagnóstico
       * el vuelo casi no avanza, así que el pájaro se queda fuera de cuadro
       * y una medición diría que no cuesta nada por el motivo equivocado.
       * Con uno alcanza: los otros tres son el mismo material y la misma
       * geometría a otra escala.
       */
      posar: (t = 0.5) => {
        registro.current[0]?.posar(t)
      },
      soltar: () => {
        registro.current.forEach((c) => c.soltar())
      },
      cuantos: BANDADA.length,
    }
    ;(window as unknown as { __arbolia_pajaro?: typeof api }).__arbolia_pajaro = api
    return () => {
      delete (window as unknown as { __arbolia_pajaro?: typeof api }).__arbolia_pajaro
    }
  }, [])

  return (
    <>
      {BANDADA.map((config, i) => (
        <UnPajaro key={config.color.oscuro} config={config} geos={geos} registro={registro} indice={i} tema={tema} />
      ))}
    </>
  )
}
