import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getTreeModel } from './treeGeometry'
import { trunkRadius } from './tubeBuilder'

/**
 * Una ardilla de luz que llega por el piso, TREPA EL TRONCO, mira desde
 * arriba y baja de cabeza antes de irse.
 *
 * PROTOTIPO, rama `animales`. La primera versión corría por una rama de la
 * copa y el pedido fue claro: tiene que verse MUY sensiblemente subir desde
 * un costado y bajar del árbol. Eso cambia el escenario: el tronco es la
 * pieza más central y más gruesa de la pantalla, así que un animalito
 * trepándolo se ve siempre, mientras que en la copa se perdía entre el
 * follaje.
 *
 * El viaje completo, unos diecisiete segundos:
 *
 *   llega   corre por el piso desde un costado hasta la base
 *   sube    trepa el tronco a tirones, pegada a la corteza
 *   pausa   se detiene arriba y mira alrededor
 *   baja    desciende DE CABEZA, que es como bajan las ardillas reales
 *   seva    corre por el piso hacia el otro lado y desaparece
 *
 * Dos detalles que hacen que se lea:
 *
 * TREPA POR EL LADO QUE MIRA LA CÁMARA. El azimut de la subida se elige al
 * arrancar según dónde está la cámara, así el viaje ocurre en la cara
 * visible del tronco y no en la de atrás. La cámara orbita despacio, así que
 * durante el viaje se corre un poco, pero nunca lo suficiente como para
 * esconderla.
 *
 * VA APOYADA EN LA CORTEZA DE VERDAD. La distancia al eje del tronco sale de
 * trunkRadius(t), la misma función con la que se construyó el tubo del
 * tronco: más gorda abajo, más fina arriba. Sin eso la ardilla flota al
 * subir o se hunde en la madera.
 */

const ESPERA_MIN = 26
const ESPERA_MAX = 48

/** Blanco cálido. Ninguna de las ocho áreas usa nada parecido. */
const COLOR = '#ffdfc0'

/*
 * A 2.4 parecía un oso abrazando el tronco: medía un tercio del árbol.
 * Una ardilla real sería invisible; esto es el punto medio entre que se
 * lea el animal y que las proporciones no den risa.
 */
const TAMANO = 1.35

/** Hasta dónde llegan las patas por debajo del origen, en unidades locales. */
const PIES = 0.132

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

function crearCuerpo(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.09, 8, 6)
  geo.scale(1, 0.82, 2.6)
  return geo
}

function crearCabeza(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.068, 7, 5)
  geo.scale(1, 1.05, 1.1)
  geo.translate(0, 0.05, -0.27)
  return geo
}

function crearPatas(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  for (const z of [-0.14, 0.12]) {
    for (const x of [-0.07, 0.07]) {
      const g = new THREE.SphereGeometry(0.028, 5, 4)
      g.scale(0.8, 1.5, 0.8)
      g.translate(x, -0.09, z)
      geos.push(g)
    }
  }
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

/** Cola: sube por detrás y acompaña el lomo sin taparlo. */
function crearCola(): THREE.BufferGeometry {
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.0, 0.2),
    new THREE.Vector3(0, 0.13, 0.32),
    new THREE.Vector3(0, 0.29, 0.34),
    new THREE.Vector3(0, 0.42, 0.27),
    new THREE.Vector3(0, 0.48, 0.15),
  ])
  const SEG = 14
  const ANILLO = 6
  const geo = new THREE.TubeGeometry(curva, SEG, 0.05, ANILLO, false)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const centro = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG
    const grosor = 0.42 + Math.sin(t * Math.PI) * 0.75
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

export default function Ardilla() {
  const grupo = useRef<THREE.Group>(null)
  const cola = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const model = useMemo(() => getTreeModel(), [])
  const cuerpoGeo = useMemo(crearCuerpo, [])
  const cabezaGeo = useMemo(crearCabeza, [])
  const colaGeo = useMemo(crearCola, [])
  const patasGeo = useMemo(crearPatas, [])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  )

  const viaje = useRef<Viaje | null>(null)
  const espera = useRef(10)
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
      // Trotecito sobre el piso.
      punto.y += Math.abs(Math.sin(reloj.current * 9)) * 0.05
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
      // Gira la cabeza (el cuerpo entero, a esta escala da igual) a un lado
      // y al otro.
      const giro = Math.sin(local * Math.PI * 3) * 0.55
      tangente.applyAxisAngle(arriba, giro)
      velocidadAparente = 0.2
    }

    g.position.copy(punto)

    /*
     * Orientación con transición suave. En los cambios de fase el "arriba"
     * salta —del piso a la corteza, de mirar hacia arriba a bajar de
     * cabeza— y un salto seco parece un corte de edición. El slerp con
     * constante corta lo convierte en un gesto: la ardilla se da vuelta.
     */
    mira.copy(punto).add(tangente)
    matriz.lookAt(punto, mira, arriba)
    rotObjetivo.setFromRotationMatrix(matriz)
    g.quaternion.slerp(rotObjetivo, 1 - Math.exp(-9 * paso))

    // La cola se mece más cuanto más quieta está: contrapeso y "estoy viva".
    if (cola.current) {
      const meneo = nombre === 'pausa' ? 0.34 : 0.16
      cola.current.rotation.x = Math.sin(reloj.current * 3.1) * meneo - velocidadAparente * 0.1
      cola.current.rotation.z = Math.sin(reloj.current * 2.3) * meneo * 0.6
    }
  })

  return (
    <group ref={grupo} name="ardilla" scale={TAMANO} visible={false}>
      <mesh geometry={cuerpoGeo} material={material} />
      <mesh geometry={cabezaGeo} material={material} />
      <mesh geometry={patasGeo} material={material} />
      <mesh ref={cola} geometry={colaGeo} material={material} />
    </group>
  )
}
