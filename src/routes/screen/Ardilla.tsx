import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTreeModel, type Twig } from './treeGeometry'

/**
 * Una ardilla de luz que corre por una rama cada tanto.
 *
 * PROTOTIPO, rama `animales`. Es bastante más difícil que el pájaro y vale
 * decir por qué: un pájaro cruza por aire libre, así que su recorrido es una
 * curva inventada. Una ardilla tiene que ir PEGADA A UNA RAMA, y si la rama
 * no es una rama de verdad se nota enseguida.
 *
 * Acá se puede porque el árbol guarda cada ramita como una curva
 * (CatmullRomCurve3, ver treeGeometry). La ardilla toma una al azar y la
 * recorre con getPointAt y getTangentAt, separada del eje por el radio de esa
 * ramita: va sobre la corteza, no atravesándola.
 *
 * LO QUE LA HACE LEERSE COMO ARDILLA ES LA COLA. A la distancia de un LED el
 * cuerpo es una mancha; lo que el ojo reconoce es esa cola gruesa y curvada
 * más larga que el animal. Por eso la cola tiene más geometría que todo el
 * resto junto.
 *
 * Y CORRE A TIRONES. Una ardilla no se desplaza parejo: arranca, frena, mira,
 * vuelve a arrancar. Moverla a velocidad constante la convierte en un juguete
 * sobre un riel. La velocidad va modulada y el cuerpo cabecea con cada
 * arranque.
 *
 * Comparte el idioma del pájaro: hecha de luz, sin ningún color de área —los
 * ocho colores del árbol significan de qué habla cada idea— y en un tono
 * cálido para distinguirse del pájaro, que es frío.
 */

const ESPERA_MIN = 30
const ESPERA_MAX = 55

/** Lo que tarda en recorrer la rama. */
const CARRERA_S = 9

/** Blanco cálido. Ninguna de las ocho áreas usa nada parecido. */
const COLOR = '#ffdfc0'

const TAMANO = 2.4

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Cuerpo: un elipsoide corto, achatado.
 *
 * Se parte de una esfera de pocos segmentos y se la estira: sale un bulto
 * convincente con 80 triángulos, y a esta distancia no hace falta más.
 */
function crearCuerpo(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.09, 8, 6)
  // Largo y bajo. La primera versión era casi una pelota y, al lado de la
  // cola, desaparecía: el conjunto se leía como un gancho, no como un animal.
  geo.scale(1, 0.82, 2.6)
  return geo
}

/** Cabeza: grande respecto del cuerpo, como la tiene una ardilla. */
function crearCabeza(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.068, 7, 5)
  geo.scale(1, 1.05, 1.1)
  geo.translate(0, 0.05, -0.27)
  return geo
}

/**
 * Dos patas apenas insinuadas.
 *
 * A esta distancia no se ven como patas, pero apoyan el cuerpo contra la
 * rama. Sin ellas la ardilla flota, y flotando cualquier bulto se lee como
 * un adorno colgado en vez de un animal parado.
 */
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
  // Se fusionan a mano para que las cuatro sean una sola llamada de dibujo.
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
 * Cola: un tubo que sube por detrás y se curva sobre el lomo, afinándose.
 *
 * TubeGeometry da radio constante, así que después se afinan los anillos a
 * mano: cada anillo se acerca a su punto de la curva según cuán lejos esté
 * de la raíz. Sin ese afinado la cola parece una manguera.
 */
function crearCola(): THREE.BufferGeometry {
  /*
   * Sube por detrás y se inclina hacia adelante SIN pasar por encima de la
   * cabeza. La primera versión terminaba en z negativo, o sea adelante del
   * animal, y eso cerraba el gancho: el conjunto se leía como un signo de
   * pregunta. La cola de una ardilla sube y acompaña el lomo, no lo tapa.
   */
  const curva = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.0, 0.2),
    new THREE.Vector3(0, 0.13, 0.32),
    new THREE.Vector3(0, 0.29, 0.34),
    new THREE.Vector3(0, 0.42, 0.27),
    new THREE.Vector3(0, 0.48, 0.15),
  ])

  const SEG = 14
  const ANILLO = 6
  // Más fina que antes: 0.075 la dejaba más gruesa que el propio cuerpo.
  const geo = new THREE.TubeGeometry(curva, SEG, 0.05, ANILLO, false)

  // Afinado: el anillo i se contrae hacia el eje de la curva.
  const pos = geo.attributes.position as THREE.BufferAttribute
  const centro = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG
    // Gorda en el medio, fina en los dos extremos: así nace del lomo y
    // termina en punta.
    const grosor = 0.42 + Math.sin(t * Math.PI) * 0.75
    curva.getPointAt(t, centro)
    for (let j = 0; j <= ANILLO; j++) {
      const idx = i * (ANILLO + 1) + j
      v.fromBufferAttribute(pos, idx)
      v.sub(centro).multiplyScalar(grosor).add(centro)
      pos.setXYZ(idx, v.x, v.y, v.z)
    }
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/** Las ramitas madre: nacen del tronco y son las más largas. */
function ramitasCandidatas(): Twig[] {
  const model = getTreeModel()
  const madres: Twig[] = []
  for (const rama of model.branches) {
    for (const twig of rama.twigs) {
      if (twig.parent === -1) madres.push(twig)
    }
  }
  return madres
}

export default function Ardilla() {
  const grupo = useRef<THREE.Group>(null)
  const cola = useRef<THREE.Mesh>(null)

  const cuerpoGeo = useMemo(crearCuerpo, [])
  const cabezaGeo = useMemo(crearCabeza, [])
  const colaGeo = useMemo(crearCola, [])
  const patasGeo = useMemo(crearPatas, [])
  const ramitas = useMemo(ramitasCandidatas, [])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR),
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  )

  const carrera = useRef<{ twig: Twig; t: number; sentido: 1 | -1 } | null>(null)
  const espera = useRef(12)
  const reloj = useRef(0)
  const congelado = useRef(false)

  const arrancar = () => {
    if (ramitas.length === 0) return
    const twig = ramitas[Math.floor(Math.random() * ramitas.length)]
    const sentido = Math.random() < 0.65 ? 1 : -1
    carrera.current = { twig, t: sentido === 1 ? 0.08 : 0.92, sentido }
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api = {
      correr: arrancar,
      posar: (t = 0.5) => {
        if (ramitas.length === 0) return
        const twig = ramitas[Math.floor(Math.random() * ramitas.length)]
        carrera.current = { twig, t: Math.min(0.97, Math.max(0.03, t)), sentido: 1 }
        congelado.current = true
      },
      soltar: () => {
        congelado.current = false
      },
      ramitas: ramitas.length,
    }
    ;(window as unknown as { __arbolia_ardilla?: typeof api }).__arbolia_ardilla = api
    return () => {
      delete (window as unknown as { __arbolia_ardilla?: typeof api }).__arbolia_ardilla
    }
  }, [ramitas])

  const normal = useMemo(() => new THREE.Vector3(), [])
  const punto = useMemo(() => new THREE.Vector3(), [])
  const tangente = useMemo(() => new THREE.Vector3(), [])
  const mira = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const g = grupo.current
    if (!g) return

    const paso = Math.min(delta, 0.05)
    reloj.current += paso

    if (!carrera.current) {
      g.visible = false
      espera.current -= paso
      if (espera.current <= 0) arrancar()
      return
    }

    const c = carrera.current

    /*
     * A tirones, no parejo. El factor va de 0.15 a 1: en los valles la
     * ardilla casi se detiene, que es cuando parece que mira alrededor.
     */
    const pulso = Math.sin(reloj.current * 2.1) * 0.5 + 0.5
    const impulso = 0.15 + Math.pow(pulso, 1.7) * 1.5

    if (!congelado.current) {
      c.t += (paso / CARRERA_S) * impulso * c.sentido
    }

    if (c.t <= 0.02 || c.t >= 0.98) {
      carrera.current = null
      espera.current = ESPERA_MIN + Math.random() * (ESPERA_MAX - ESPERA_MIN)
      g.visible = false
      return
    }

    g.visible = true

    c.twig.curve.getPointAt(c.t, punto)
    c.twig.curve.getTangentAt(c.t, tangente)
    if (c.sentido === -1) tangente.negate()

    // Perpendicular a la rama, lo más "hacia arriba" posible: es el lado por
    // el que la ardilla va apoyada.
    normal.copy(UP).addScaledVector(tangente, -UP.dot(tangente))
    if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1)
    normal.normalize()

    // Cabeceo del galope, sincronizado con el impulso.
    const cabeceo = Math.sin(reloj.current * 4.2) * 0.02 * impulso

    g.position
      .copy(punto)
      .addScaledVector(normal, c.twig.radius * TAMANO + 0.12 * TAMANO + cabeceo)

    // La orientación usa `up` propio para que quede parada sobre la rama y
    // no acostada: lookAt respeta object.up.
    g.up.copy(normal)
    mira.copy(g.position).add(tangente)
    g.lookAt(mira)

    // La cola se mece contra el sentido de la carrera: contrapeso.
    if (cola.current) {
      cola.current.rotation.x = Math.sin(reloj.current * 3.1) * 0.18 - impulso * 0.12
      cola.current.rotation.z = Math.sin(reloj.current * 2.3) * 0.1
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
