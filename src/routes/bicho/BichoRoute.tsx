import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import Ardilla from '../screen/Ardilla'
import Perrito from '../screen/Perrito'
import Pajaro from '../screen/Pajaro'
import TreeStructure from '../screen/TreeStructure'
import { getGrowthProfile } from '../../lib/growth'
import { useTema } from '../../lib/tema'
import './bicho.css'

/**
 * Banco de pruebas de la fauna. SÓLO EN DESARROLLO.
 *
 * No entra al build de producción: App.tsx ni siquiera crea el import
 * dinámico cuando import.meta.env.DEV es false, así que Rollup descarta el
 * chunk entero. La instalación no sabe que esto existe.
 *
 * POR QUÉ HACE FALTA.
 *
 * Los tres animales miden entre 1.35 y 2.4 unidades al lado de un árbol de
 * 6.64, visto desde una cámara que orbita a ocho unidades. En el LED del
 * stand eso son unas decenas de píxeles: alcanza para juzgar si el
 * movimiento se lee, que es para lo que se hicieron, y no alcanza para
 * juzgar una silueta. Trabajar la anatomía mirando un bicho de cuarenta
 * píxeles que además pasa cada treinta segundos es adivinar.
 *
 * Acá el animal ocupa la pantalla, la cámara da vueltas alrededor, y el
 * viaje se puede congelar en cualquier punto para mirar una pose quieta.
 *
 * QUÉ NO ES. No es una escena nueva: monta EXACTAMENTE los mismos
 * componentes que el árbol, con las mismas geometrías y los mismos
 * materiales. Si acá se ve bien y en el árbol no, la diferencia es de
 * escala o de fondo, no de código, y eso también es información.
 */

type Bicho = 'ardilla' | 'perrito' | 'pajaro'

interface ApiBicho {
  posar: (p?: number) => void
  soltar: () => void
}

/** Dónde vive el control de desarrollo de cada uno. */
const API: Record<Bicho, string> = {
  ardilla: '__arbolia_ardilla',
  perrito: '__arbolia_perrito',
  pajaro: '__arbolia_pajaro',
}

/**
 * Qué objeto de la escena sigue la cámara.
 *
 * Coincide con el nombre del bicho salvo en el pájaro: son cuatro, con
 * nombres pajaro-0 a pajaro-3, y posar() congela solamente al primero —el
 * celeste, el original de la bandada—. Seguir a cualquier otro sería
 * perseguir a uno que no se detiene.
 */
const EN_ESCENA: Record<Bicho, string> = {
  ardilla: 'ardilla',
  perrito: 'perrito',
  pajaro: 'pajaro-0',
}

function apiDe(bicho: Bicho): ApiBicho | null {
  return (window as unknown as Record<string, ApiBicho | undefined>)[API[bicho]] ?? null
}

export default function BichoRoute() {
  const [tema, alternarTema] = useTema()
  const [bicho, setBicho] = useState<Bicho>('ardilla')
  const [pose, setPose] = useState(0.45)
  const [congelado, setCongelado] = useState(true)
  const [conArbol, setConArbol] = useState(false)
  const [malla, setMalla] = useState(false)
  const [distancia, setDistancia] = useState(1)

  /*
   * El árbol en su etapa media. La ardilla trepa el tronco de verdad —su
   * distancia al eje sale de trunkRadius()— así que aunque el árbol no se
   * dibuje, el modelo tiene que existir y estar a la escala en la que se
   * la va a ver.
   */
  const growth = useMemo(() => getGrowthProfile(240, 500), [])

  /*
   * Aplicar la pose cada vez que cambia el bicho, el punto o el congelado.
   *
   * Con reintento, y no por prolijidad: cada animal publica su control en
   * window desde su PROPIO efecto, y esos corren adentro del reconciliador
   * de r3f, que monta los hijos del <Canvas> después de que este efecto ya
   * pasó. En el primer intento el control todavía no existe, así que sin
   * reintentar la pantalla abre vacía —el bicho invisible, esperando su
   * turno de aparecer— y hay que mover el deslizador para que aparezca
   * algo. Que la herramienta arranque en blanco es justo lo que uno no
   * quiere de una herramienta.
   */
  useEffect(() => {
    let vivo = true

    const aplicar = () => {
      if (!vivo) return
      const api = apiDe(bicho)
      if (!api) {
        window.setTimeout(aplicar, 60)
        return
      }
      if (congelado) api.posar(pose)
      else api.soltar()
    }

    aplicar()
    return () => {
      vivo = false
    }
  }, [bicho, pose, congelado])

  return (
    <div className="bicho" data-tema={tema}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 38, near: 0.05, far: 80, position: [4, 1.5, 4] }}
      >
        <color attach="background" args={[tema === 'claro' ? '#f7fafd' : '#050a12']} />

        {/*
          Sin postprocesado y sin niebla, a propósito. Los dos suavizan
          bordes, y acá lo que se está juzgando ES el borde. El bloom del
          árbol perdona una silueta floja; este banco no tiene que
          perdonarla.
        */}

        <group scale={growth.canopyScale}>
          {conArbol && (
            <TreeStructure
              growth={growth}
              highlightSlug={null}
              pulsoRaices={0}
              tema={tema}
            />
          )}
          <Ardilla tema={tema} />
          <Perrito tema={tema} />
          <Pajaro tema={tema} />
        </group>

        <Seguidor nombre={EN_ESCENA[bicho]} distancia={distancia} />
        <Malla activa={malla} />
        <Piso tema={tema} escala={growth.canopyScale} />
      </Canvas>

      <div className="bicho__panel">
        <div className="bicho__fila">
          {(['ardilla', 'perrito', 'pajaro'] as Bicho[]).map((b) => (
            <button
              key={b}
              type="button"
              className={b === bicho ? 'bicho__tab bicho__tab--activa' : 'bicho__tab'}
              onClick={() => setBicho(b)}
            >
              {b}
            </button>
          ))}
        </div>

        <label className="bicho__campo">
          <span>
            pose <b>{pose.toFixed(2)}</b>
          </span>
          <input
            type="range"
            min={0}
            max={0.99}
            step={0.01}
            value={pose}
            onChange={(e) => {
              setPose(Number(e.target.value))
              setCongelado(true)
            }}
          />
        </label>

        <label className="bicho__campo">
          <span>
            cámara <b>{distancia.toFixed(2)}×</b>
          </span>
          <input
            type="range"
            min={0.4}
            max={3}
            step={0.05}
            value={distancia}
            onChange={(e) => setDistancia(Number(e.target.value))}
          />
        </label>

        <div className="bicho__fila">
          <button type="button" className="bicho__tab" onClick={() => setCongelado((c) => !c)}>
            {congelado ? '▶ soltar' : '⏸ congelar'}
          </button>
          <button type="button" className="bicho__tab" onClick={alternarTema}>
            {tema === 'oscuro' ? '☀ claro' : '☾ oscuro'}
          </button>
        </div>

        <div className="bicho__fila">
          <button
            type="button"
            className={conArbol ? 'bicho__tab bicho__tab--activa' : 'bicho__tab'}
            onClick={() => setConArbol((v) => !v)}
          >
            árbol
          </button>
          <button
            type="button"
            className={malla ? 'bicho__tab bicho__tab--activa' : 'bicho__tab'}
            onClick={() => setMalla((v) => !v)}
          >
            malla
          </button>
        </div>

        <p className="bicho__pie">
          Banco de pruebas · sólo en desarrollo
        </p>
      </div>
    </div>
  )
}

/**
 * La cámara persigue al bicho elegido y le da vueltas alrededor.
 *
 * Lo busca por nombre en la escena y no por referencia porque los
 * componentes de la fauna no exponen ninguna: son cajas cerradas que se
 * mueven solas, y ese es justamente el punto —acá se mira lo mismo que se
 * va a ver en el árbol, sin una versión paralela que se desincronice.
 *
 * El encuadre se calcula del tamaño real del objeto, no de una distancia
 * fija: los tres miden distinto y la cola de la ardilla cambia bastante la
 * caja envolvente según la pose.
 */
function Seguidor({ nombre, distancia }: { nombre: string; distancia: number }) {
  const { camera, scene } = useThree()
  const caja = useMemo(() => new THREE.Box3(), [])
  const centro = useMemo(() => new THREE.Vector3(), [])
  const tamano = useMemo(() => new THREE.Vector3(), [])
  const objetivo = useMemo(() => new THREE.Vector3(), [])
  const reloj = useRef(0)

  useFrame((_, delta) => {
    reloj.current += delta

    const obj = scene.getObjectByName(nombre)
    if (!obj || !obj.visible) return

    caja.setFromObject(obj)
    if (caja.isEmpty()) return
    caja.getCenter(centro)
    caja.getSize(tamano)

    /*
     * Radio a partir del bulto del animal. El máximo de los tres ejes
     * más un margen: con el promedio, la ardilla con la cola desplegada
     * se salía de cuadro por arriba.
     */
    const bulto = Math.max(tamano.x, tamano.y, tamano.z)
    const radio = Math.max(0.6, bulto * 2.1) * distancia

    // Vuelta lenta: una órbita cada ~24 s. Suficiente para ver cómo se
    // arma la silueta desde todos lados sin marear al mirar un rato.
    const a = reloj.current * 0.26
    objetivo.set(
      centro.x + Math.cos(a) * radio,
      centro.y + bulto * 0.45,
      centro.z + Math.sin(a) * radio,
    )

    // Suavizado: al cambiar de bicho o de pose el salto sería un corte.
    camera.position.lerp(objetivo, 1 - Math.exp(-6 * delta))
    camera.lookAt(centro)
  })

  return null
}

/**
 * Modo malla: pasa TODOS los materiales de la escena a wireframe.
 *
 * Es la única forma de ver de dónde sale una silueta: dónde hay
 * subdivisiones de sobra, dónde faltan, y sobre todo dónde dos partes se
 * interpenetran. Con material aditivo y sin escritura de profundidad, dos
 * esferas encajadas una dentro de otra se ven exactamente igual que una
 * sola forma continua, y esa confusión es media explicación de por qué los
 * animales se leen inflados.
 */
function Malla({ activa }: { activa: boolean }) {
  const { scene } = useThree()

  useEffect(() => {
    const tocados: THREE.Material[] = []
    scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material
      if (!mat || Array.isArray(mat)) return
      if (!('wireframe' in mat)) return
      ;(mat as THREE.MeshBasicMaterial).wireframe = activa
      tocados.push(mat)
    })
    return () => {
      for (const m of tocados) (m as THREE.MeshBasicMaterial).wireframe = false
    }
  }, [activa, scene])

  return null
}

/**
 * Un piso mínimo, sólo para tener referencia de dónde apoya el bicho.
 *
 * Una grilla y no un disco de luz: acá no se está juzgando la atmósfera,
 * se está juzgando si las patas tocan el suelo o flotan, y para eso una
 * retícula con perspectiva dice mucho más que un degradado.
 */
function Piso({ tema, escala }: { tema: 'claro' | 'oscuro'; escala: number }) {
  const grilla = useMemo(() => {
    const g = new THREE.GridHelper(
      20,
      40,
      tema === 'claro' ? 0x9db4c8 : 0x1d3a4d,
      tema === 'claro' ? 0xd6e2ec : 0x142433,
    )
    const mat = g.material as THREE.Material
    mat.transparent = true
    mat.opacity = 0.6
    return g
  }, [tema])

  return <primitive object={grilla} position={[0, -0.02 * escala, 0]} />
}
