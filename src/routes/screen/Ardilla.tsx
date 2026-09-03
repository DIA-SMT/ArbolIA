import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getTreeModel } from './treeGeometry'
import { trunkRadius } from './tubeBuilder'
import { createFaunaMaterial } from './faunaMaterial'
import { fusionar, miembro, pelaje, tuboPerfilado } from './formaAnimal'

/**
 * Una ardilla de luz que llega por el piso, TREPA EL TRONCO, mira desde
 * arriba y baja de cabeza antes de irse.
 *
 * PROTOTIPO, rama `animales`. Sobre el pedido de que sea "hiperrealista":
 * lo que se puede empujar hacia lo real acá es la ANATOMÍA y el MOVIMIENTO
 * —pecho y grupa diferenciados, orejas paradas, patas que galopan en pares,
 * la cola en S— no el material. El árbol es luz estilizada, y una ardilla
 * con pelo fotográfico al lado de un árbol de neón rompería la armonía que
 * el mismo pedido exige. Un animal se reconoce por su silueta y por cómo se
 * mueve mucho antes que por su textura.
 *
 * El viaje completo, unos diecisiete segundos:
 *
 *   llega   galopa por el piso desde un costado hasta la base
 *   sube    trepa el tronco a tirones, pegada a la corteza
 *   pausa   se detiene arriba y mira alrededor
 *   baja    desciende DE CABEZA, que es como bajan las ardillas reales
 *   seva    galopa hacia el otro lado y desaparece
 *
 * Trepa por el lado que mira la cámara (el azimut se elige al arrancar) y
 * va apoyada en la corteza de verdad: la distancia al eje sale de
 * trunkRadius(t), la misma función con la que se construyó el tubo del
 * tronco. Sin eso flota al subir o se hunde en la madera.
 *
 * DOS TEMAS: en oscuro la ardilla es luz aditiva blanco-cálida, como todo
 * lo vivo de la escena. En claro el fondo es casi blanco y el aditivo
 * desaparece físicamente (sumar luz sobre blanco da blanco), así que ahí
 * se vuelve TINTA: castaño apagado con blending normal, como dibujada a
 * lápiz sobre papel. El vestuario sale de APARIENCIA[tema]; la anatomía y
 * el viaje son exactamente los mismos en los dos.
 */

const ESPERA_MIN = 16
const ESPERA_MAX = 34

/**
 * Vestuario por tema. Regla inviolable: los ocho colores de área del árbol
 * significan "de qué habla una idea", y la ardilla no puede confundirse con
 * ninguno. Por eso en oscuro va un blanco cálido pálido y en claro un
 * castaño tinta desaturado: ningún área usa nada parecido.
 */
const APARIENCIA = {
  oscuro: { color: '#ffc890', opacidad: 0.42, blending: THREE.AdditiveBlending },
  claro: { color: '#8a5a3c', opacidad: 0.85, blending: THREE.NormalBlending },
} as const

/*
 * A 2.4 parecía un oso abrazando el tronco: medía un tercio del árbol.
 * Este es el punto medio entre que se lea el animal y que las proporciones
 * no den risa.
 */
const TAMANO = 1.35

/**
 * Hasta dónde llegan las patas por debajo del origen, en unidades locales.
 *
 * NO ES UN NÚMERO LIBRE: sale de sumar la geometría de las patas, y si
 * queda corto la ardilla se hunde en la corteza mientras trepa; si queda
 * largo, flota despegada. Con las patas nuevas la cuenta del par trasero,
 * que es el que llega más abajo, es:
 *
 *   0.030   posición del par en el grupo (la línea de cadera)
 * + 0.020   corrimiento de la pata dentro de su malla
 * + 0.132   alto 0.062 + bajo 0.058 + los 0.012 que baja el pie
 * = 0.182
 *
 * El par delantero está mediado para llegar EXACTAMENTE a la misma altura
 * con un miembro más corto, colgado de un hombro más bajo: ver
 * crearParDePatas y las posiciones del render.
 */
const PIES = 0.182

/** Altura del origen del grupo sobre la superficie de apoyo (las patas). */
const APOYO = PIES * TAMANO + 0.02

/** Hasta qué punto del tronco sube como mínimo y máximo (0..1). */
const SUBIDA_MIN = 0.4
const SUBIDA_MAX = 0.62

const FASES: Array<[string, number]> = [
  ['llega', 2.6],
  ['sube', 5.6],
  ['pausa', 1.8],
  ['baja', 4.0],
  ['seva', 2.6],
]
const DURACION_TOTAL = FASES.reduce((s, [, d]) => s + d, 0)

/** En qué fase cae el progreso global p (0..1) y cuánto lleva de ella. */
function faseDe(p: number): { nombre: string; local: number } {
  let acumulado = 0
  for (const [nombre, dur] of FASES) {
    const fin = acumulado + dur / DURACION_TOTAL
    if (p < fin) return { nombre, local: (p - acumulado) / (dur / DURACION_TOTAL) }
    acumulado = fin
  }
  return { nombre: 'seva', local: 1 }
}

/**
 * Avance a tirones pero monótono: arranca, frena, vuelve a arrancar sin
 * retroceder nunca. La derivada se mantiene positiva porque la amplitud del
 * seno es menor que la pendiente.
 */
function aTirones(s: number, tirones: number): number {
  return s - Math.sin(s * tirones * Math.PI * 2) / (tirones * Math.PI * 2.6)
}

/**
 * Torso de una sola pieza: cuello, pecho, cintura y grupa.
 *
 * Antes eran dos esferas escaladas y fusionadas, y en el banco de pruebas
 * se veía lo que eso es de cerca: un muñeco de nieve, con una garganta
 * marcada justo donde las dos esferas se tocan. Ninguna esfera está mal
 * por separado; lo que falla es que un animal no tiene juntas.
 *
 * Ahora el eje recorre el animal de la nuca a la base de la cola y el
 * perfil pone el bulto donde va:
 *
 *   0.00  cuello, angosto — de acá sale la cabeza
 *   0.28  pecho, ancho — la caja torácica
 *   0.55  CINTURA, más angosta que las dos vecinas
 *   0.82  grupa, lo más ancho y lo más alto del animal
 *   1.00  base de la cola, cerrando
 *
 * La cintura es el detalle que más trabaja de los cinco. Un cuerpo que va
 * engordando parejo de adelante hacia atrás se lee como una bolsa; la
 * entrada en el medio es lo que hace que el pecho y la grupa se lean como
 * DOS masas de un mismo cuerpo, que es lo que son.
 *
 * El eje además sube hacia atrás: la ardilla en cuatro patas tiene la
 * grupa más alta que los hombros, y esa joroba es su silueta.
 */
function crearCuerpo(): THREE.BufferGeometry {
  return tuboPerfilado(
    [
      new THREE.Vector3(0, 0.028, -0.2),
      new THREE.Vector3(0, 0.005, -0.11),
      new THREE.Vector3(0, -0.004, 0.0),
      new THREE.Vector3(0, 0.017, 0.11),
      new THREE.Vector3(0, 0.045, 0.2),
    ],
    (t) => {
      if (t < 0.28) return THREE.MathUtils.lerp(0.62, 1.0, t / 0.28)
      if (t < 0.55) return THREE.MathUtils.lerp(1.0, 0.88, (t - 0.28) / 0.27)
      if (t < 0.82) return THREE.MathUtils.lerp(0.88, 1.12, (t - 0.55) / 0.27)
      return THREE.MathUtils.lerp(1.12, 0.5, (t - 0.82) / 0.18)
    },
    { segmentos: 26, lados: 12, radio: 0.086, tapas: true },
  )
}

/**
 * Cabeza con hocico en cuña y OREJAS PARADAS: la firma de la silueta.
 *
 * El cráneo dejó de ser una esfera con otra esfera de hocico pegada
 * adelante. Es un tubo perfilado que va de la nuca a la nariz y se afina
 * en cuña, que es la forma real de una cabeza de roedor vista de perfil:
 * ancha atrás, en punta adelante, sin escalón en el medio.
 *
 * Las orejas siguen siendo conos, y está bien que lo sean: son finas,
 * planas y su gracia es el contorno, no el volumen.
 */
function crearCabeza(): THREE.BufferGeometry {
  const craneo = tuboPerfilado(
    [
      new THREE.Vector3(0, 0.075, -0.17),
      new THREE.Vector3(0, 0.082, -0.215),
      new THREE.Vector3(0, 0.072, -0.262),
      new THREE.Vector3(0, 0.055, -0.3),
    ],
    (t) => {
      // Nuca ancha, pómulo lleno, y de ahí en cuña hasta la nariz.
      if (t < 0.35) return THREE.MathUtils.lerp(0.86, 1.0, t / 0.35)
      return THREE.MathUtils.lerp(1.0, 0.34, (t - 0.35) / 0.65)
    },
    { segmentos: 16, lados: 12, radio: 0.058, tapas: true },
  )

  /*
   * Orejas: conos con una inclinación hacia afuera y hacia atrás. Antes
   * iban perfectamente verticales y paralelas, que es lo que hace que un
   * animal parezca de juguete — nada en un cuerpo vivo es simétrico y
   * perpendicular.
   */
  const orejas: THREE.BufferGeometry[] = []
  for (const lado of [-1, 1]) {
    const o = new THREE.ConeGeometry(0.019, 0.055, 7)
    o.scale(1, 1, 0.55)
    o.rotateZ(lado * 0.24)
    o.rotateX(-0.16)
    o.translate(lado * 0.033, 0.142, -0.185)
    orejas.push(o)
  }

  return fusionar([craneo, ...orejas])
}

/**
 * Un par de patas colgando de una misma cadera.
 *
 * Las ardillas no trotan: SALTAN. Las dos delanteras se mueven juntas y las
 * dos traseras juntas, en contrafase. Por eso las patas van en dos mallas
 * —par delantero, par trasero— y no en cuatro: el par entero rota desde su
 * línea de cadera.
 *
 * Cada pata dejó de ser un cilindro. Un cilindro recto terminado en un
 * corte plano no se parece a ninguna pata: no tiene rodilla, no tiene pie
 * y no se afina. Ahora son miembros con quiebre (ver formaAnimal.ts), y el
 * quiebre va en sentidos opuestos según el par, como en el animal:
 *
 *   traseras   el corvejón se dobla hacia ATRÁS y el fémur es largo — es
 *              el resorte con el que la ardilla salta
 *   delanteras el codo se dobla hacia ADELANTE y todo el miembro es más
 *              corto, casi un brazo
 *
 * Ese desbalance entre pares no es un detalle: es la razón por la que una
 * ardilla parada se lee como una ardilla y no como un perro chico.
 */
function crearParDePatas(traseras: boolean): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []

  for (const x of [-0.05, 0.05]) {
    const pata = traseras
      ? miembro({
          alto: 0.062,
          bajo: 0.058,
          // Hacia atrás: el corvejón sobresale por detrás de la grupa.
          quiebre: 0.03,
          radioCadera: 0.028,
          radioMedio: 0.017,
          radioTobillo: 0.012,
          // El pie trasero de una ardilla es largo — es media pata.
          pie: 0.05,
        })
      : miembro({
          /*
           * El brazo mide 0.102 contra los 0.12 de la pierna: sigue siendo
           * más corto, que es parte de la silueta de la ardilla. Llega al
           * suelo igual porque cuelga de un hombro más bajo —ver la
           * posición del par delantero en el render—, y eso también es
           * anatómico: en un roedor en cuatro patas la cruz está por
           * debajo de la grupa.
           */
          alto: 0.052,
          bajo: 0.05,
          // Hacia adelante: el codo del brazo.
          quiebre: -0.022,
          radioCadera: 0.02,
          radioMedio: 0.013,
          radioTobillo: 0.0105,
          pie: 0.028,
        })

    pata.translate(x, -0.02, 0)
    geos.push(pata)

    if (traseras) {
      /*
       * MUSLO: la masa que envuelve el fémur, pegada a la cadera. Sigue
       * acá, fusionado en la malla del par, para que rote CON él en el
       * galope. Lo que cambió es que ahora se apoya sobre una pata que
       * tiene forma, así que dejó de ser el único bulto de la pierna y
       * pasó a ser lo que es: el arranque.
       */
      const muslo = new THREE.SphereGeometry(0.042, 10, 8)
      muslo.scale(0.72, 1.05, 1.15)
      muslo.translate(x, -0.028, 0.008)
      geos.push(muslo)
    } else {
      /*
       * HOMBRO: la misma idea que el muslo, en chico. Un miembro que sale
       * del torso sin nada que lo envuelva deja un ángulo vivo en la
       * axila, y ese ángulo es lo que hace que el brazo se lea PEGADO al
       * cuerpo en vez de nacido de él.
       *
       * Es bastante más chico que el muslo trasero a propósito: en una
       * ardilla el tren delantero es liviano y el trasero es el motor.
       */
      const hombro = new THREE.SphereGeometry(0.028, 9, 7)
      hombro.scale(0.75, 1, 1.1)
      hombro.translate(x, -0.014, 0.004)
      geos.push(hombro)
    }
  }
  return fusionar(geos)
}

/**
 * La cola: una PLUMA, no un tubo.
 *
 * Es lo que el ojo usa para decir "ardilla", y era lo que peor estaba. El
 * tubo anterior tenía sección circular y llegaba a ser tan grueso como el
 * cuerpo entero, así que de cerca se leía como una banana pegada al lomo.
 *
 * Dos cambios, los dos anatómicos:
 *
 *  1. ES PLANA. Una cola de ardilla no es un cilindro peludo: es un abanico
 *     de pelo que sale hacia los dos lados de un eje. De perfil es enorme;
 *     de frente, casi una línea. El aplastado en X al final es literalmente
 *     eso, y es lo que más cambia la lectura: la misma silueta de costado,
 *     pero con un volumen que ya no compite con el cuerpo.
 *  2. NACE FINA. El arranque baja a un tercio: en el animal la cola sale de
 *     un rabo delgado y recién después se abre el pelo. Sin esa cintura, la
 *     cola parecía brotar del lomo como un globo atado.
 *
 * La curva en S y la punta reclinada sobre la espalda no se tocan: esa
 * pose es la que dice "ardilla" aun a cuarenta píxeles.
 */
function crearCola(): THREE.BufferGeometry {
  const geo = tuboPerfilado(
    /*
     * El arco se cerró respecto de la versión anterior: la punta llegaba a
     * y = 0.55 y z = 0.38, o sea que la cola barría un espacio más grande
     * que el animal entero y se leía como un aro pegado atrás. Ahora se
     * recuesta sobre el lomo, que es donde la lleva una ardilla parada.
     */
    [
      new THREE.Vector3(0, 0.02, 0.21),
      new THREE.Vector3(0, 0.095, 0.31),
      new THREE.Vector3(0, 0.235, 0.335),
      new THREE.Vector3(0, 0.365, 0.285),
      new THREE.Vector3(0, 0.445, 0.165),
      new THREE.Vector3(0, 0.465, 0.045),
    ],
    (t) => {
      /*
       * Rabo fino en el arranque, el pelo abriéndose después, y la punta
       * que se cierra sin llegar a cero: una pluma no termina en aguja.
       *
       * El máximo bajó de 1.55 a 1.22. A 1.55 el grosor de la cola era el
       * 80 % del grosor del cuerpo: mirada de costado no era una pluma,
       * era un segundo animal. Lo que hace grande a una cola de ardilla es
       * el ANCHO del pelo, no el diámetro del rabo.
       *
       * Encima va la ondulación de pelaje: catorce ciclos al 6 %. No se
       * ven como ondas —a la escala en que esto aparece en pantalla son
       * fracciones de píxel— pero le sacan al contorno esa perfección de
       * pieza torneada que era lo último que delataba el juguete.
       */
      const base =
        t < 0.16
          ? THREE.MathUtils.lerp(0.32, 0.86, t / 0.16)
          : t < 0.6
            ? THREE.MathUtils.lerp(0.86, 1.22, (t - 0.16) / 0.44)
            : THREE.MathUtils.lerp(1.22, 0.38, (t - 0.6) / 0.4)
      return base * pelaje(t, 14, 0.06)
    },
    {
      segmentos: 30,
      lados: 10,
      radio: 0.05,
      tapas: true,
      /*
       * El aplastado NO es parejo, y este es el detalle que convierte el
       * tubo en una pluma.
       *
       * En el nacimiento la cola es un rabo: redondo, o casi. El pelo se
       * abre después, y desde ahí la sección es mucho más alta que ancha —
       * de costado la cola es enorme, de frente es casi una línea—. Con un
       * aplastado uniforme, el rabo quedaba tan chato como el pelo y la
       * unión con la grupa se leía como una cinta pegada.
       */
      aplanarX: (t) => THREE.MathUtils.lerp(0.92, 0.36, Math.min(1, t / 0.34)),
    },
  )

  geo.computeVertexNormals()
  return geo
}

interface Viaje {
  /** Dirección radial del lado del tronco por el que trepa. */
  radial: THREE.Vector3
  llegada: THREE.CatmullRomCurve3
  salida: THREE.CatmullRomCurve3
  alturaMax: number
  p: number
}

export default function Ardilla({ tema = 'oscuro' }: { tema?: 'claro' | 'oscuro' }) {
  const grupo = useRef<THREE.Group>(null)
  const cuerpo = useRef<THREE.Mesh>(null)
  const cola = useRef<THREE.Mesh>(null)
  const patasDelanteras = useRef<THREE.Mesh>(null)
  const patasTraseras = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const model = useMemo(() => getTreeModel(), [])
  const cuerpoGeo = useMemo(crearCuerpo, [])
  const cabezaGeo = useMemo(crearCabeza, [])
  const colaGeo = useMemo(crearCola, [])
  const patasDelGeo = useMemo(() => crearParDePatas(false), [])
  const patasTrasGeo = useMemo(() => crearParDePatas(true), [])

  /*
   * El material sombreado, no MeshBasicMaterial.
   *
   * Con el básico esta ardilla era un recorte plano: dos esferas y un tubo
   * rellenos de un color liso, sin una sola gradación, y el aditivo
   * aclarando cada superposición. La forma estaba en la geometría y no
   * llegaba nunca a la pantalla. Ver faunaMaterial.ts.
   *
   * La opacidad baja respecto de la tabla porque el sombreado agrega
   * brillo donde pega la luz: manteniendo el 0.42 plano, el lomo iluminado
   * pasaba a ser lo más brillante de la escena después de las hojas.
   */
  const material = useMemo(() => {
    const a = APARIENCIA[tema]
    return createFaunaMaterial({
      color: a.color,
      opacidad: a.opacidad * (tema === 'oscuro' ? 0.78 : 1),
      tema,
    })
  }, [tema])

  const viaje = useRef<Viaje | null>(null)
  const espera = useRef(7)
  const reloj = useRef(0)
  const congelado = useRef(false)

  // Temporales reutilizados: nada de esto puede crear objetos por cuadro.
  const punto = useMemo(() => new THREE.Vector3(), [])
  const tangente = useMemo(() => new THREE.Vector3(), [])
  const arriba = useMemo(() => new THREE.Vector3(), [])
  const mira = useMemo(() => new THREE.Vector3(), [])
  const matriz = useMemo(() => new THREE.Matrix4(), [])
  const rotObjetivo = useMemo(() => new THREE.Quaternion(), [])

  /** Punto de contacto con el tronco a la altura t, del lado elegido. */
  const puntoDeTronco = (radial: THREE.Vector3, t: number, destino: THREE.Vector3) => {
    model.trunk.getPointAt(t, destino)
    destino.addScaledVector(radial, trunkRadius(t) + APOYO)
    return destino
  }

  const arrancar = () => {
    /*
     * El lado visible: el azimut de la cámara. Como el grupo del árbol no
     * rota y su escala es uniforme, el azimut en mundo y en local coinciden.
     */
    const az = Math.atan2(camera.position.x, camera.position.z)
    const radial = new THREE.Vector3(Math.sin(az), 0, Math.cos(az))

    const lado = Math.random() < 0.5 ? 1 : -1
    const azEntrada = az + lado * (1.15 + Math.random() * 0.35)
    const azSalida = az - lado * (1.0 + Math.random() * 0.4)

    const base = puntoDeTronco(radial, 0.02, new THREE.Vector3())
    base.y = APOYO * 0.55

    const entrada = new THREE.Vector3(Math.sin(azEntrada), 0, Math.cos(azEntrada))
      .multiplyScalar(3.9)
      .setY(APOYO * 0.55)
    const salida = new THREE.Vector3(Math.sin(azSalida), 0, Math.cos(azSalida))
      .multiplyScalar(4.2)
      .setY(APOYO * 0.55)

    const medioLlegada = entrada.clone().lerp(base, 0.55).setLength(entrada.length() * 0.5)
    medioLlegada.y = APOYO * 0.55
    const medioSalida = base.clone().lerp(salida, 0.5).setLength(salida.length() * 0.55)
    medioSalida.y = APOYO * 0.55

    viaje.current = {
      radial,
      llegada: new THREE.CatmullRomCurve3([entrada, medioLlegada, base]),
      salida: new THREE.CatmullRomCurve3([base, medioSalida, salida]),
      alturaMax: SUBIDA_MIN + Math.random() * (SUBIDA_MAX - SUBIDA_MIN),
      p: 0,
    }
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      correr: arrancar,
      /** Congela el viaje en un progreso 0..1 (0.35 ≈ mitad de la subida). */
      posar: (p = 0.35) => {
        arrancar()
        if (viaje.current) viaje.current.p = Math.min(0.99, Math.max(0, p))
        congelado.current = true
      },
      soltar: () => {
        congelado.current = false
      },
      fases: FASES.map(([n, d]) => `${n} ${d}s`),
    }
    ;(window as unknown as { __arbolia_ardilla?: typeof api }).__arbolia_ardilla = api
    return () => {
      delete (window as unknown as { __arbolia_ardilla?: typeof api }).__arbolia_ardilla
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, delta) => {
    const g = grupo.current
    if (!g) return

    const paso = Math.min(delta, 0.05)
    reloj.current += paso

    if (!viaje.current) {
      g.visible = false
      espera.current -= paso
      if (espera.current <= 0) arrancar()
      return
    }

    const v = viaje.current
    if (!congelado.current) v.p += paso / DURACION_TOTAL

    if (v.p >= 1) {
      viaje.current = null
      espera.current = ESPERA_MIN + Math.random() * (ESPERA_MAX - ESPERA_MIN)
      g.visible = false
      return
    }

    g.visible = true
    const { nombre, local } = faseDe(v.p)
    const t0 = 0.02

    let velocidadAparente = 1

    if (nombre === 'llega' || nombre === 'seva') {
      const curva = nombre === 'llega' ? v.llegada : v.salida
      const u = Math.min(0.999, Math.max(0.001, local))
      curva.getPointAt(u, punto)
      curva.getTangentAt(u, tangente)
      arriba.set(0, 1, 0)
      // Salto del galope: el cuerpo entero sube y baja con cada brinco.
      punto.y += Math.abs(Math.sin(reloj.current * 7)) * 0.06
    } else if (nombre === 'sube' || nombre === 'baja') {
      const s = aTirones(Math.min(1, Math.max(0, local)), nombre === 'sube' ? 4 : 3)
      const t = nombre === 'sube'
        ? t0 + (v.alturaMax - t0) * s
        : v.alturaMax - (v.alturaMax - t0) * s
      velocidadAparente = 0.3 + Math.abs(Math.cos(s * (nombre === 'sube' ? 4 : 3) * Math.PI * 2)) * 1.2

      puntoDeTronco(v.radial, t, punto)
      model.trunk.getTangentAt(t, tangente)
      // Bajando va DE CABEZA, como las ardillas reales.
      if (nombre === 'baja') tangente.negate()
      arriba.copy(v.radial)
    } else {
      // Pausa arriba: quieta, mirando alrededor.
      puntoDeTronco(v.radial, v.alturaMax, punto)
      model.trunk.getTangentAt(v.alturaMax, tangente)
      arriba.copy(v.radial)
      const giro = Math.sin(local * Math.PI * 3) * 0.55
      tangente.applyAxisAngle(arriba, giro)
      velocidadAparente = 0.2
    }

    g.position.copy(punto)

    /*
     * Orientación con transición suave. En los cambios de fase el "arriba"
     * salta —del piso a la corteza, de mirar hacia arriba a bajar de
     * cabeza— y un salto seco parece un corte de edición. El slerp lo
     * convierte en un gesto: la ardilla se da vuelta.
     */
    mira.copy(punto).add(tangente)
    matriz.lookAt(punto, mira, arriba)
    rotObjetivo.setFromRotationMatrix(matriz)
    g.quaternion.slerp(rotObjetivo, 1 - Math.exp(-9 * paso))

    /*
     * GALOPE. Las ardillas no trotan: saltan. Los dos pares de patas van en
     * contrafase —las traseras empujan, las delanteras aterrizan— y el lomo
     * se arquea con cada brinco. La amplitud sigue a la velocidad: en los
     * frenos del tirón las patas casi se detienen y el animal "duda", que
     * es el gesto más de ardilla que existe.
     */
    const brinco = Math.sin(reloj.current * 7) * Math.min(1, velocidadAparente)
    if (patasDelanteras.current) patasDelanteras.current.rotation.x = brinco * 0.7
    if (patasTraseras.current) patasTraseras.current.rotation.x = -brinco * 0.8
    if (cuerpo.current) cuerpo.current.rotation.x = brinco * 0.09

    // La cola se mece más cuanto más quieta está.
    if (cola.current) {
      const meneo = nombre === 'pausa' ? 0.3 : 0.14
      cola.current.rotation.x = Math.sin(reloj.current * 3.1) * meneo - velocidadAparente * 0.08
      cola.current.rotation.z = Math.sin(reloj.current * 2.3) * meneo * 0.6
    }
  })

  return (
    <group ref={grupo} name="ardilla" scale={TAMANO} visible={false}>
      <mesh ref={cuerpo} geometry={cuerpoGeo} material={material} />
      <mesh geometry={cabezaGeo} material={material} />
      {/* Caderas: cada par de patas cuelga de su línea y rota desde ahí. */}
      {/*
        El hombro va MÁS BAJO que la cadera: -0.048 contra -0.030.

        Las dos cosas a la vez. Anatómicamente, una ardilla en cuatro patas
        tiene la cruz por debajo de la grupa —es la joroba que el torso ya
        dibuja— así que el brazo cuelga de más abajo. Y aritméticamente, es
        lo que hace que un miembro delantero de 0.102 y uno trasero de 0.120
        apoyen los cuatro pies a la misma altura, que es la condición para
        que el animal no cojee ni flote. Si se toca uno de estos números,
        hay que rehacer la cuenta de PIES.
      */}
      <mesh ref={patasDelanteras} geometry={patasDelGeo} material={material} position={[0, -0.048, -0.13]} />
      <mesh ref={patasTraseras} geometry={patasTrasGeo} material={material} position={[0, -0.03, 0.13]} />
      <mesh ref={cola} geometry={colaGeo} material={material} />
    </group>
  )
}
