import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getTreeModel } from './treeGeometry'
import { trunkRadius } from './tubeBuilder'

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

/** Hasta dónde llegan las patas por debajo del origen, en unidades locales. */
const PIES = 0.16

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

function fusionar(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = geos.reduce((n, g) => n + (g.attributes.position as THREE.BufferAttribute).count, 0)
  const pos = new Float32Array(total * 3)
  const idx: number[] = []
  let off = 0
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute
    pos.set(p.array as Float32Array, off * 3)
    const i = g.getIndex()
    if (i) for (let k = 0; k < i.count; k++) idx.push(i.getX(k) + off)
    off += p.count
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/**
 * Cuerpo con anatomía: pecho angosto adelante, grupa alta y redonda atrás.
 * La joroba trasera es LA forma de una ardilla en cuatro patas; el
 * elipsoide parejo de la versión anterior era la forma de una papa.
 */
function crearCuerpo(): THREE.BufferGeometry {
  const pecho = new THREE.SphereGeometry(0.07, 8, 6)
  pecho.scale(0.92, 0.95, 1.35)
  pecho.translate(0, -0.005, -0.1)

  const grupa = new THREE.SphereGeometry(0.092, 8, 6)
  grupa.scale(1, 1.12, 1.35)
  grupa.translate(0, 0.03, 0.1)

  return fusionar([pecho, grupa])
}

/** Cabeza con hocico en punta y OREJAS PARADAS: la firma de la silueta. */
function crearCabeza(): THREE.BufferGeometry {
  const cabeza = new THREE.SphereGeometry(0.056, 8, 6)
  cabeza.scale(0.95, 1, 1.2)
  cabeza.translate(0, 0.075, -0.21)

  const hocico = new THREE.SphereGeometry(0.028, 6, 4)
  hocico.scale(0.85, 0.8, 1.5)
  hocico.translate(0, 0.06, -0.28)

  const orejaI = new THREE.ConeGeometry(0.018, 0.05, 5)
  orejaI.translate(-0.032, 0.145, -0.2)
  const orejaD = new THREE.ConeGeometry(0.018, 0.05, 5)
  orejaD.translate(0.032, 0.145, -0.2)

  return fusionar([cabeza, hocico, orejaI, orejaD])
}

/**
 * Un par de patas colgando de una misma cadera.
 *
 * Las ardillas no trotan: SALTAN. Las dos delanteras se mueven juntas y las
 * dos traseras juntas, en contrafase. Por eso las patas van en dos mallas
 * —par delantero, par trasero— y no en cuatro: el par entero rota desde su
 * línea de cadera.
 */
function crearParDePatas(traseras: boolean): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  /*
   * Las delanteras son más cortas: en una ardilla real los brazos miden
   * bastante menos que las piernas, y ese desbalance es parte de la
   * silueta. Los pies de los dos pares apoyan a la misma altura (-0.12),
   * así que el cilindro se cuelga desde abajo, no desde la cadera.
   */
  const largo = traseras ? 0.12 : 0.09
  for (const x of [-0.05, 0.05]) {
    const g = new THREE.CylinderGeometry(
      traseras ? 0.02 : 0.015,
      traseras ? 0.024 : 0.018,
      largo,
      5,
    )
    g.translate(x, -0.12 + largo / 2, 0)
    geos.push(g)
    if (traseras) {
      /*
       * MUSLO: esfera achatada pegada a la cadera, donde nace la pata. Es
       * la marca visual de la ardilla sentada o saltando; sin él las patas
       * son palitos de insecto. Va en esta misma malla a propósito: rota
       * CON el par trasero en el galope, como el muslo de verdad.
       */
      const muslo = new THREE.SphereGeometry(0.045, 7, 5)
      muslo.scale(0.7, 1, 1.2)
      muslo.translate(x, -0.02, 0)
      geos.push(muslo)
    }
  }
  return fusionar(geos)
}

/**
 * La cola en S: nace fina del lomo, se ensancha a lo bruto y termina en
 * punta inclinada sobre la espalda. Es lo que más geometría lleva de todo
 * el animal, porque es lo que el ojo usa para decir "ardilla".
 */
function crearCola(): THREE.BufferGeometry {
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.02, 0.22),
    new THREE.Vector3(0, 0.1, 0.34),
    new THREE.Vector3(0, 0.26, 0.38),
    new THREE.Vector3(0, 0.42, 0.32),
    new THREE.Vector3(0, 0.52, 0.18),
    new THREE.Vector3(0, 0.55, 0.04),
  ])
  const SEG = 18
  const ANILLO = 7
  const geo = new THREE.TubeGeometry(curva, SEG, 0.052, ANILLO, false)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const centro = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG
    // Fina en la base, muy gorda pasada la mitad, en punta al final.
    const grosor = 0.5 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 1.3
    curva.getPointAt(t, centro)
    for (let j = 0; j <= ANILLO; j++) {
      const k = i * (ANILLO + 1) + j
      v.fromBufferAttribute(pos, k)
      v.sub(centro).multiplyScalar(grosor).add(centro)
      pos.setXYZ(k, v.x, v.y, v.z)
    }
  }
  pos.needsUpdate = true
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

  const material = useMemo(() => {
    const a = APARIENCIA[tema]
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(a.color),
      transparent: true,
      opacity: a.opacidad,
      blending: a.blending,
      // depthWrite apagado en los dos temas: la ardilla no debe taparle
      // el z-buffer a las hojas que tiene detrás.
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
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
      <mesh ref={patasDelanteras} geometry={patasDelGeo} material={material} position={[0, -0.03, -0.13]} />
      <mesh ref={patasTraseras} geometry={patasTrasGeo} material={material} position={[0, -0.03, 0.13]} />
      <mesh ref={cola} geometry={colaGeo} material={material} />
    </group>
  )
}
