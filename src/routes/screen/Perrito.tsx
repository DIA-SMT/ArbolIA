import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { trunkRadius } from './tubeBuilder'
import { createFaunaMaterial } from './faunaMaterial'
import { fusionar, miembro, pelaje, tuboPerfilado } from './formaAnimal'

/**
 * Un perrito de luz que pasa caminando, olfatea el tronco, levanta la pata
 * y sigue de largo.
 *
 * PROTOTIPO, rama `animales`, y sí: hace pis en el árbol. Es el toque de
 * humor del trío. La escena es contemplativa y solemne, y un perrito que
 * hace exactamente lo que haría un perrito de verdad frente a un árbol —el
 * único árbol de toda la pantalla— es el tipo de guiño que la gente
 * fotografía.
 *
 * Está hecho con la misma disciplina que los otros dos:
 *
 *  · de luz en oscuro, de tinta en claro: sobre el fondo nocturno es brillo
 *    aditivo como todo lo vivo de la escena, pero sobre el fondo casi blanco
 *    del tema claro el aditivo no existe físicamente (sumar luz sobre blanco
 *    da blanco), así que ahí pasa a blending normal con opacidad alta;
 *  · sin ningún color de área: dorado pálido desaturado en oscuro, tan tinta
 *    apagado en claro, y el chorrito amarillo en los dos temas, que es todo
 *    el chiste que hace falta;
 *  · pasa por el lado que mira la cámara, como la ardilla, así el momento
 *    no ocurre en la cara oculta del tronco.
 *
 * El viaje, unos trece segundos:
 *
 *   entra     trota desde un costado hasta la base del tronco
 *   olfatea   se frena, baja la cabeza contra la corteza
 *   orina     levanta la pata trasera; aparece el arquito
 *   seva      trota hacia el otro lado y desaparece
 */

const ESPERA_MIN = 30
const ESPERA_MAX = 60

/**
 * Vestuario por tema. Ningún tono se acerca a los 8 colores de área: esos
 * significan "de qué habla una idea" y el perrito no habla de nada.
 *
 *  · oscuro: dorado pálido y desaturado (lejos del amarillo saturado de
 *    Tecnología), aditivo y tenue, como el resto de la fauna.
 *  · claro: tan tinta apagado con blending normal y opacidad alta, porque
 *    el aditivo sobre el fondo casi blanco es invisible.
 *
 * El chorrito es amarillo en los dos temas —ese chiste no se negocia—; en
 * claro solo cambia a blending normal para que exista sobre blanco. Las
 * opacidades viven acá y no en el bucle, así los fundidos por cuadro salen
 * de la base del tema activo.
 */
const APARIENCIA = {
  oscuro: {
    cuerpo: '#f0d9a8',
    cuerpoOpacidad: 0.4,
    pisOpacidad: 0.8,
    blending: THREE.AdditiveBlending,
  },
  claro: {
    cuerpo: '#8f7355',
    cuerpoOpacidad: 0.85,
    pisOpacidad: 0.9,
    blending: THREE.NormalBlending,
  },
} as const

const COLOR_PIS = '#ffe000'

const TAMANO = 1.6

/**
 * Hasta dónde llegan las patas por debajo del origen, en unidades locales.
 *
 * NO ES UN NÚMERO LIBRE: sale de sumar la geometría de las patas, y APOYO
 * lo usa para posar al perro sobre el piso. Corto, el perro se hunde;
 * largo, camina en el aire. Con los miembros nuevos, y las cuatro patas
 * llegando a la misma altura:
 *
 *   0.060   posición de la pata en el grupo (la línea de cadera)
 * + 0.140   el miembro: 0.162 de recorrido menos los 0.022 que sube su
 *           origen para meterse dentro del hombro
 * = 0.200
 *
 * Era 0.22 con los cilindros viejos. Si se cambia el largo de un miembro,
 * este número se recalcula o el perro deja de tocar el suelo.
 */
const PIES = 0.2

/** Altura del origen del grupo sobre el piso (donde apoyan las patas). */
const APOYO = PIES * TAMANO + 0.02

const FASES: Array<[string, number]> = [
  ['entra', 4.0],
  ['olfatea', 1.4],
  ['orina', 3.0],
  ['seva', 4.0],
]
const DURACION_TOTAL = FASES.reduce((s, [, d]) => s + d, 0)

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
 * Torso de una sola pieza: pecho hondo, cintura marcada, grupa.
 *
 * Era UNA esfera estirada a 2.1 de largo, y en el banco de pruebas se veía
 * lo que eso es: un poroto. Un perro visto de perfil no tiene forma de
 * elipsoide — tiene el pecho hondo y bajo entre las patas delanteras, la
 * panza recogida en el medio y la grupa más alta y corta atrás. Esa curva
 * de abajo, la línea del vientre, es media silueta de perro.
 *
 * El eje va del pecho (-Z, adelante) a la cola (+Z) y sube hacia atrás; el
 * perfil pone el bulto:
 *
 *   0.00  base del cuello
 *   0.26  PECHO, lo más ancho y lo más hondo
 *   0.60  cintura recogida
 *   0.84  grupa
 *   1.00  nacimiento de la cola
 */
function crearCuerpo(): THREE.BufferGeometry {
  return tuboPerfilado(
    [
      new THREE.Vector3(0, 0.028, -0.21),
      new THREE.Vector3(0, -0.004, -0.1),
      new THREE.Vector3(0, -0.012, 0.02),
      new THREE.Vector3(0, 0.012, 0.13),
      new THREE.Vector3(0, 0.042, 0.22),
    ],
    (t) => {
      if (t < 0.26) return THREE.MathUtils.lerp(0.66, 1.0, t / 0.26)
      if (t < 0.6) return THREE.MathUtils.lerp(1.0, 0.82, (t - 0.26) / 0.34)
      if (t < 0.84) return THREE.MathUtils.lerp(0.82, 0.98, (t - 0.6) / 0.24)
      return THREE.MathUtils.lerp(0.98, 0.44, (t - 0.84) / 0.16)
    },
    { segmentos: 26, lados: 12, radio: 0.094, tapas: true },
  )
}

/**
 * Cabeza y cuello, todo fusionado en una sola malla: la silueta gana sin
 * sumar draw calls.
 *
 * Eran tres esferas y un cilindro —cráneo, hocico, orejas, cuello—, y de
 * cerca se notaba cada junta: sobre todo el escalón donde el hocico se
 * enchufaba en la cara, que es el defecto clásico del perro de juguete.
 *
 * Ahora cuello, cráneo y hocico son UN SOLO tubo perfilado que arranca en
 * el pecho y termina en la nariz. El perfil hace todo el trabajo: se
 * ensancha al llegar al cráneo, y de ahí baja en una curva continua hasta
 * la trufa. El STOP —ese escaloncito entre la frente y el hocico que tienen
 * casi todas las razas— queda insinuado por el cambio de pendiente del
 * perfil, no por dos volúmenes chocándose.
 */
function crearCabeza(): THREE.BufferGeometry {
  const cabeza = tuboPerfilado(
    [
      // Nace adentro del pecho, así el cuello no se despega del torso.
      new THREE.Vector3(0, 0.0, -0.13),
      new THREE.Vector3(0, 0.055, -0.18),
      new THREE.Vector3(0, 0.092, -0.235),
      new THREE.Vector3(0, 0.082, -0.29),
      new THREE.Vector3(0, 0.062, -0.335),
    ],
    (t) => {
      // Cuello, que se ensancha hacia la nuca.
      if (t < 0.34) return THREE.MathUtils.lerp(0.5, 0.78, t / 0.34)
      // Cráneo: la parte más ancha.
      if (t < 0.56) return THREE.MathUtils.lerp(0.78, 1.0, (t - 0.34) / 0.22)
      // El stop: la caída rápida de la frente al puente del hocico.
      if (t < 0.68) return THREE.MathUtils.lerp(1.0, 0.62, (t - 0.56) / 0.12)
      // Y el hocico, que se afina despacio hasta la trufa.
      return THREE.MathUtils.lerp(0.62, 0.34, (t - 0.68) / 0.32)
    },
    { segmentos: 22, lados: 12, radio: 0.077, tapas: true },
  )

  /*
   * Orejas caídas: elipsoides chatos colgando del costado del cráneo, con
   * una inclinación hacia afuera. La oreja que cuelga es lo que separa a
   * este perro de la ardilla en una silueta de cuarenta píxeles, así que
   * pesa más de lo que su tamaño sugiere.
   */
  const orejas: THREE.BufferGeometry[] = []
  for (const lado of [-1, 1]) {
    const o = new THREE.SphereGeometry(0.024, 9, 7)
    o.scale(0.42, 1.5, 0.85)
    o.rotateZ(lado * 0.3)
    o.translate(lado * 0.062, 0.088, -0.232)
    orejas.push(o)
  }

  return fusionar([cabeza, ...orejas])
}

/**
 * Una pata delantera, colgando de su hombro.
 *
 * Son CUATRO mallas separadas y no un bloque fusionado, porque un perro que
 * se desliza con las patas rígidas se lee como un bug —lo reportó el equipo
 * con esas palabras—. Sueltas, trotan en pares diagonales, que es como trota
 * un perro de verdad.
 *
 * Dejó de ser un cilindro, y esto era lo más visible de los tres animales:
 * cuatro cilindros idénticos, rectos, del mismo grosor de arriba abajo y
 * cortados en seco al ras del suelo. Sin codo, sin garra y sin nada que los
 * uniera al cuerpo — en el banco se veían literalmente despegados del
 * torso, cuatro palos flotando debajo del poroto.
 *
 * La delantera es casi recta —un perro apoya el brazo casi a plomo— con un
 * codo apenas insinuado hacia atrás y una garra corta adelante.
 */
function crearPata(): THREE.BufferGeometry {
  const g = miembro({
    alto: 0.075,
    bajo: 0.075,
    // Codo hacia atrás, poco: la delantera de un perro es casi una columna.
    quiebre: 0.018,
    radioCadera: 0.03,
    radioMedio: 0.019,
    radioTobillo: 0.016,
    pie: 0.036,
  })
  /*
   * El origen sube dentro del hombro en vez de quedar en la superficie.
   * Ese medio centímetro es lo que cierra el hueco entre la pata y el
   * torso: el arranque del miembro queda METIDO en el cuerpo, como una
   * articulación de verdad, en vez de tocarlo de punta.
   */
  g.translate(0, 0.022, 0)
  return g
}

/**
 * Pata trasera: más angulada y con muslo.
 *
 * En un perro las dos traseras no son las delanteras repetidas. El fémur es
 * corto y grueso, el corvejón se quiebra fuerte hacia ATRÁS y el pie es
 * largo. Esa zeta es la que da el empuje y la que se reconoce de perfil; con
 * las cuatro patas iguales el animal se lee como una mesa.
 *
 * El muslo va fusionado adentro de esta malla para no sumar draw calls, y la
 * pata sigue siendo una malla separada con su ref, así trota y se levanta
 * igual que antes.
 */
function crearPataTrasera(): THREE.BufferGeometry {
  const pata = miembro({
    alto: 0.062,
    bajo: 0.088,
    // El quiebre del corvejón, bastante más marcado que el codo delantero.
    quiebre: 0.042,
    radioCadera: 0.034,
    radioMedio: 0.018,
    radioTobillo: 0.014,
    pie: 0.042,
  })
  pata.translate(0, 0.022, 0)

  const muslo = new THREE.SphereGeometry(0.042, 10, 8)
  muslo.scale(0.68, 1.15, 1.0)
  muslo.translate(0, -0.012, 0.006)

  return fusionar([pata, muslo])
}

/**
 * Cola en gancho, gruesa en la base y afinada hacia la punta.
 *
 * Era un tubo de grosor constante —0.014 de radio de punta a punta— y a esa
 * escala se leía como una antena o un alambre: ninguna cola de perro tiene
 * el mismo diámetro en el nacimiento que en la punta, porque el nacimiento
 * es una prolongación de la grupa y la punta es sólo pelo.
 *
 * Además ahora se arquea hacia adelante en el último tramo. Una cola alta y
 * curvada sobre el lomo es la de un perro contento, y este perro está
 * contento todo el tiempo: el bucle le mueve la cola más rápido cuanto
 * mejor la está pasando. Que la forma en reposo ya diga lo mismo que dice
 * el movimiento es lo que hace que el gesto se lea entero.
 *
 * El pivote sigue en la base —el origen de la malla— así que el meneo por
 * rotation del bucle no cambia.
 */
function crearColita(): THREE.BufferGeometry {
  return tuboPerfilado(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.055, 0.055),
      new THREE.Vector3(0, 0.115, 0.075),
      new THREE.Vector3(0, 0.165, 0.055),
      new THREE.Vector3(0, 0.19, 0.015),
    ],
    (t) => {
      // Nace del grosor de la grupa y termina en pelo.
      const base = THREE.MathUtils.lerp(1, 0.32, Math.pow(t, 0.8))
      return base * pelaje(t, 9, 0.08)
    },
    { segmentos: 18, lados: 8, radio: 0.026, tapas: true },
  )
}

/**
 * El arquito. Un tubo finito que sale de abajo de la cadera y cae contra el
 * tronco. Vive en el espacio local del perro, que en ese momento está quieto
 * con el tronco a su izquierda.
 */
function crearChorrito(): THREE.BufferGeometry {
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.02, -0.06, 0.16),
    new THREE.Vector3(0.1, -0.1, 0.16),
    new THREE.Vector3(0.18, -0.19, 0.16),
    new THREE.Vector3(0.22, -0.26, 0.16),
  ])
  return new THREE.TubeGeometry(curva, 8, 0.018, 4, false)
}

interface Paseo {
  entrada: THREE.CatmullRomCurve3
  salida: THREE.CatmullRomCurve3
  /** Hacia dónde mira mientras olfatea y orina: el tronco. */
  haciaElTronco: THREE.Vector3
  p: number
}

export default function Perrito({ tema = 'oscuro' }: { tema?: 'claro' | 'oscuro' }) {
  const grupo = useRef<THREE.Group>(null)
  const pataDI = useRef<THREE.Mesh>(null)
  const pataDD = useRef<THREE.Mesh>(null)
  const pataTI = useRef<THREE.Mesh>(null)
  const pataTD = useRef<THREE.Mesh>(null)
  const colita = useRef<THREE.Mesh>(null)
  const chorrito = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const cuerpoGeo = useMemo(crearCuerpo, [])
  const cabezaGeo = useMemo(crearCabeza, [])
  const pataGeo = useMemo(crearPata, [])
  const pataTraseraGeo = useMemo(crearPataTrasera, [])
  const colitaGeo = useMemo(crearColita, [])
  const chorritoGeo = useMemo(crearChorrito, [])

  /*
   * Cuerpo sombreado. Ver faunaMaterial.ts: con MeshBasicMaterial el perro
   * era una silueta rellena de un color liso, y sus cuatro patas —cuatro
   * cilindros sueltos— no tenían forma de distinguirse del torso.
   *
   * El chorrito NO usa este material y sigue en básico, a propósito: es un
   * tubo finito de color plano al que el bucle le maneja la opacidad
   * cuadro a cuadro para el fundido de entrada y de salida, y darle
   * volumen a un chorro de pis es resolver un problema que nadie tiene.
   */
  const material = useMemo(() => {
    const ap = APARIENCIA[tema]
    return createFaunaMaterial({
      color: ap.cuerpo,
      opacidad: ap.cuerpoOpacidad * (tema === 'oscuro' ? 0.78 : 1),
      tema,
    })
  }, [tema])

  const materialPis = useMemo(() => {
    const ap = APARIENCIA[tema]
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR_PIS),
      transparent: true,
      // Arranca cortado: la aparición y el corte los maneja el bucle.
      opacity: 0,
      blending: ap.blending,
      depthWrite: false,
      toneMapped: false,
    })
  }, [tema])

  const paseo = useRef<Paseo | null>(null)
  const espera = useRef(14)
  const reloj = useRef(0)
  const congelado = useRef(false)

  const punto = useMemo(() => new THREE.Vector3(), [])
  const tangente = useMemo(() => new THREE.Vector3(), [])
  const arriba = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const mira = useMemo(() => new THREE.Vector3(), [])
  const matriz = useMemo(() => new THREE.Matrix4(), [])
  const rotObjetivo = useMemo(() => new THREE.Quaternion(), [])

  const arrancar = () => {
    // Pasa por el lado visible, un poco corrido para no tapar el tronco.
    const az = Math.atan2(camera.position.x, camera.position.z) + 0.35
    const radial = new THREE.Vector3(Math.sin(az), 0, Math.cos(az))

    /*
     * La parada: al costado del tronco, con el tronco a la IZQUIERDA del
     * perro. El chorrito está modelado saliendo hacia +X local, así que la
     * orientación en la parada apunta el +X del perro hacia el tronco.
     */
    const distancia = trunkRadius(0.02) + 0.42
    const parada = radial.clone().multiplyScalar(distancia).setY(APOYO)

    const lado = Math.random() < 0.5 ? 1 : -1
    const azEntrada = az + lado * 1.35
    const azSalida = az - lado * 1.3

    const entrada = new THREE.Vector3(Math.sin(azEntrada), 0, Math.cos(azEntrada))
      .multiplyScalar(4.4)
      .setY(APOYO)
    const salida = new THREE.Vector3(Math.sin(azSalida), 0, Math.cos(azSalida))
      .multiplyScalar(4.6)
      .setY(APOYO)

    const medioEntrada = entrada.clone().lerp(parada, 0.5).setLength(entrada.length() * 0.6)
    medioEntrada.y = APOYO
    const medioSalida = parada.clone().lerp(salida, 0.5).setLength(salida.length() * 0.6)
    medioSalida.y = APOYO

    paseo.current = {
      entrada: new THREE.CatmullRomCurve3([entrada, medioEntrada, parada]),
      salida: new THREE.CatmullRomCurve3([parada, medioSalida, salida]),
      haciaElTronco: radial.clone().negate(),
      p: 0,
    }
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      pasar: arrancar,
      /** Congela el paseo en un progreso 0..1 (0.5 ≈ pata levantada). */
      posar: (p = 0.5) => {
        arrancar()
        if (paseo.current) paseo.current.p = Math.min(0.99, Math.max(0, p))
        congelado.current = true
      },
      soltar: () => {
        congelado.current = false
      },
      fases: FASES.map(([n, d]) => `${n} ${d}s`),
    }
    ;(window as unknown as { __arbolia_perrito?: typeof api }).__arbolia_perrito = api
    return () => {
      delete (window as unknown as { __arbolia_perrito?: typeof api }).__arbolia_perrito
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, delta) => {
    const g = grupo.current
    if (!g) return

    const paso = Math.min(delta, 0.05)
    reloj.current += paso

    if (!paseo.current) {
      g.visible = false
      espera.current -= paso
      if (espera.current <= 0) arrancar()
      return
    }

    const v = paseo.current
    if (!congelado.current) v.p += paso / DURACION_TOTAL

    if (v.p >= 1) {
      paseo.current = null
      espera.current = ESPERA_MIN + Math.random() * (ESPERA_MAX - ESPERA_MIN)
      g.visible = false
      return
    }

    g.visible = true
    const { nombre, local } = faseDe(v.p)

    let pataArriba = 0
    let pisOpacidad = 0
    let trotando = false

    if (nombre === 'entra' || nombre === 'seva') {
      trotando = true
      const curva = nombre === 'entra' ? v.entrada : v.salida
      const u = Math.min(0.999, Math.max(0.001, local))
      curva.getPointAt(u, punto)
      curva.getTangentAt(u, tangente)
      punto.y = APOYO + Math.abs(Math.sin(reloj.current * 8)) * 0.04
    } else {
      // Quieto en la parada, con el tronco a su izquierda: el frente del
      // perro (-Z) queda perpendicular a la dirección al tronco.
      v.entrada.getPointAt(0.999, punto)
      punto.y = APOYO
      tangente.crossVectors(arriba, v.haciaElTronco).normalize()

      if (nombre === 'olfatea') {
        // Baja el hocico: una inclinación leve del cuerpo entero alcanza.
        pataArriba = 0
      } else {
        /*
         * La pata sube rápido, se queda arriba y baja al final. El chorrito
         * aparece un instante después de la pata y se corta un instante
         * antes: ese pequeño desfase es lo que lo hace gracioso en vez de
         * mecánico.
         */
        const subida = Math.min(1, local / 0.15)
        const bajada = Math.min(1, (1 - local) / 0.15)
        pataArriba = Math.min(subida, bajada)
        const chorro = Math.min(1, Math.max(0, (local - 0.18) / 0.1)) *
          Math.min(1, Math.max(0, (0.92 - local) / 0.1))
        // La base del fundido sale de la apariencia del tema activo: en
        // claro necesita más opacidad para existir sobre el fondo blanco.
        pisOpacidad = chorro * APARIENCIA[tema].pisOpacidad
      }
    }

    g.position.copy(punto)
    mira.copy(punto).add(tangente)
    matriz.lookAt(punto, mira, arriba)
    rotObjetivo.setFromRotationMatrix(matriz)
    g.quaternion.slerp(rotObjetivo, 1 - Math.exp(-8 * paso))

    /*
     * Trote en pares diagonales: delantera izquierda con trasera derecha,
     * delantera derecha con trasera izquierda, en contrafase. Es el patron
     * real del trote y es lo que faltaba: con las patas rigidas el perro se
     * deslizaba como un mueble.
     */
    const zancada = trotando ? Math.sin(reloj.current * 10) * 0.5 : 0
    if (pataDI.current) pataDI.current.rotation.x += (zancada - pataDI.current.rotation.x) * Math.min(1, 14 * paso)
    if (pataTD.current && pataArriba === 0) pataTD.current.rotation.x += (zancada - pataTD.current.rotation.x) * Math.min(1, 14 * paso)
    if (pataDD.current) pataDD.current.rotation.x += (-zancada - pataDD.current.rotation.x) * Math.min(1, 14 * paso)
    if (pataTI.current) pataTI.current.rotation.x += (-zancada - pataTI.current.rotation.x) * Math.min(1, 14 * paso)

    /*
     * La pata que levanta es la trasera DERECHA, y sube hacia +X, que es el
     * lado del tronco. Antes subia hacia -X: cruzaba el cuerpo por adentro,
     * atravesaba la otra pata trasera y quedaba apuntando al lado contrario
     * del arbol. Ese era el bug de las patas.
     */
    if (pataTD.current) {
      const objetivo = pataArriba * 1.05
      pataTD.current.rotation.z += (objetivo - pataTD.current.rotation.z) * Math.min(1, 10 * paso)
      if (pataArriba > 0) pataTD.current.rotation.x += (0 - pataTD.current.rotation.x) * Math.min(1, 10 * paso)
    }

    if (chorrito.current) {
      materialPis.opacity = pisOpacidad
      chorrito.current.visible = pisOpacidad > 0.01
    }

    // La colita: contenta trotando, muy contenta orinando.
    if (colita.current) {
      const ganas = nombre === 'orina' ? 14 : trotando ? 8 : 5
      colita.current.rotation.y = Math.sin(reloj.current * ganas) * 0.5
    }
  })

  return (
    <group ref={grupo} name="perrito" scale={TAMANO} visible={false}>
      <mesh geometry={cuerpoGeo} material={material} />
      <mesh geometry={cabezaGeo} material={material} />
      <mesh ref={pataDI} geometry={pataGeo} material={material} position={[-0.06, -0.06, -0.16]} />
      <mesh ref={pataDD} geometry={pataGeo} material={material} position={[0.06, -0.06, -0.16]} />
      {/* Las traseras llevan muslo fusionado; siguen siendo mallas separadas. */}
      <mesh ref={pataTI} geometry={pataTraseraGeo} material={material} position={[-0.06, -0.06, 0.16]} />
      {/* La trasera derecha es la que levanta: del lado del tronco. */}
      <mesh ref={pataTD} geometry={pataTraseraGeo} material={material} position={[0.06, -0.06, 0.16]} />
      <mesh ref={colita} geometry={colitaGeo} material={material} position={[0, 0.06, 0.2]} />
      <mesh ref={chorrito} geometry={chorritoGeo} material={materialPis} position={[0.04, 0, 0]} visible={false} />
    </group>
  )
}
