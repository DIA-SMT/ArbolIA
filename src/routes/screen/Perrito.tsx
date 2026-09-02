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

/**
 * Cabeza con hocico, orejas caídas y cuello, todo fusionado en una sola
 * malla: la silueta gana sin sumar draw calls.
 */
function crearCabeza(): THREE.BufferGeometry {
  const cabeza = new THREE.SphereGeometry(0.075, 7, 5)
  cabeza.translate(0, 0.09, -0.24)
  // Hocico: esfera escalada a ~0.05 de ancho, 0.04 de alto y 0.09 de largo,
  // adelante y un poco abajo del centro de la cabeza.
  const hocico = new THREE.SphereGeometry(0.03, 6, 4)
  hocico.scale(0.83, 0.67, 1.5)
  hocico.translate(0, 0.065, -0.31)
  // Orejas caídas: esferas chatas colgando a los costados-arriba.
  const orejaI = new THREE.SphereGeometry(0.022, 5, 4)
  orejaI.scale(1, 1.4, 0.5)
  orejaI.translate(-0.068, 0.1, -0.23)
  const orejaD = orejaI.clone()
  orejaD.translate(0.136, 0, 0)
  // Cuello: cilindro corto inclinado uniendo el pecho con la cabeza, porque
  // sin él la cabeza flotaba despegada del cuerpo.
  const cuello = new THREE.CylinderGeometry(0.032, 0.04, 0.13, 6)
  cuello.rotateX(-0.85)
  cuello.translate(0, 0.05, -0.19)
  return fusionar([cabeza, hocico, orejaI, orejaD, cuello])
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

/**
 * Pata trasera: el mismo cilindro más un muslo —esfera achatada arriba, el
 * mismo truco que la ardilla—. Va fusionado adentro de la malla de la pata
 * para no sumar draw calls; la pata sigue siendo una malla separada con su
 * ref, así trota y se levanta igual que antes.
 */
function crearPataTrasera(): THREE.BufferGeometry {
  const pata = crearPata()
  const muslo = new THREE.SphereGeometry(0.036, 6, 5)
  muslo.scale(0.7, 1.15, 1.2)
  muslo.translate(0, -0.035, 0)
  return fusionar([pata, muslo])
}

/**
 * Cola con curva: un tubo corto sobre una curva de 3 puntos que sube con una
 * leve comba, en vez del cilindro recto que parecía una antena. El pivote
 * sigue en la base (el origen de la malla), así el meneo por rotation del
 * bucle no cambia.
 */
function crearColita(): THREE.BufferGeometry {
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.05, 0.06),
    new THREE.Vector3(0, 0.13, 0.09),
  ])
  return new THREE.TubeGeometry(curva, 8, 0.014, 5, false)
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

  const material = useMemo(() => {
    const ap = APARIENCIA[tema]
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(ap.cuerpo),
      transparent: true,
      opacity: ap.cuerpoOpacidad,
      blending: ap.blending,
      depthWrite: false,
      toneMapped: false,
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
