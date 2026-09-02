import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { trunkRadius } from './tubeBuilder'

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
 *  · de luz, no de textura: en esta pantalla todo lo que brilla es de la
 *    misma materia;
 *  · sin ningún color de área: va en un dorado pálido desaturado, y el
 *    chorrito apenas más dorado, que es todo el chiste que hace falta;
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

const ESPERA_MIN = 45
const ESPERA_MAX = 80

/** Dorado pálido y desaturado: lejos del amarillo saturado de Tecnología. */
const COLOR = '#f0d9a8'
const COLOR_PIS = '#ffe000'

const TAMANO = 1.6

/** Hasta dónde llegan las patas por debajo del origen, en unidades locales. */
const PIES = 0.22

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

function crearCuerpo(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.1, 8, 6)
  geo.scale(0.95, 0.9, 2.1)
  return geo
}

/** Cabeza con hocico: dos esferas fusionadas leen como perro enseguida. */
function crearCabeza(): THREE.BufferGeometry {
  const cabeza = new THREE.SphereGeometry(0.075, 7, 5)
  cabeza.translate(0, 0.09, -0.24)
  const hocico = new THREE.SphereGeometry(0.042, 6, 4)
  hocico.scale(0.9, 0.75, 1.5)
  hocico.translate(0, 0.06, -0.33)
  // Orejas caídas: dos gotitas a los costados.
  const orejaI = new THREE.SphereGeometry(0.028, 5, 4)
  orejaI.scale(0.6, 1.4, 0.8)
  orejaI.translate(-0.07, 0.11, -0.22)
  const orejaD = orejaI.clone()
  orejaD.translate(0.14, 0, 0)
  return fusionar([cabeza, hocico, orejaI, orejaD])
}

/**
 * Una pata suelta, colgando de su cadera.
 *
 * Son CUATRO mallas separadas y no un bloque fusionado, porque un perro que
 * se desliza con las patas rígidas se lee como un bug —lo reportó el equipo
 * con esas palabras—. Sueltas, trotan en pares diagonales, que es como trota
 * un perro de verdad.
 */
function crearPata(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.02, 0.024, 0.16, 5)
  // El origen queda en la cadera para que la rotación sea desde ahí.
  g.translate(0, -0.08, 0)
  return g
}

/** Cola finita hacia arriba, para menearla. */
function crearColita(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.012, 0.02, 0.16, 5)
  g.translate(0, 0.07, 0)
  g.rotateX(0.7)
  return g
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

interface Paseo {
  entrada: THREE.CatmullRomCurve3
  salida: THREE.CatmullRomCurve3
  /** Hacia dónde mira mientras olfatea y orina: el tronco. */
  haciaElTronco: THREE.Vector3
  p: number
}

export default function Perrito() {
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
  const colitaGeo = useMemo(crearColita, [])
  const chorritoGeo = useMemo(crearChorrito, [])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )

  const materialPis = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR_PIS),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )

  const paseo = useRef<Paseo | null>(null)
  const espera = useRef(20)
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
        pisOpacidad = chorro * 0.8
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
      <mesh ref={pataTI} geometry={pataGeo} material={material} position={[-0.06, -0.06, 0.16]} />
      {/* La trasera derecha es la que levanta: del lado del tronco. */}
      <mesh ref={pataTD} geometry={pataGeo} material={material} position={[0.06, -0.06, 0.16]} />
      <mesh ref={colita} geometry={colitaGeo} material={material} position={[0, 0.06, 0.2]} />
      <mesh ref={chorrito} geometry={chorritoGeo} material={materialPis} position={[0.04, 0, 0]} visible={false} />
    </group>
  )
}
