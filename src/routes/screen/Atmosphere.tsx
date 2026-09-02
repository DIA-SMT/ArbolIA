import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getGlowTexture } from './leafAssets'
import { blendingDe, type Tema } from './temaEscena'
import type { GrowthProfile } from '../../lib/types'

const MAX_MOTES = 700
const FIELD_RADIUS = 5.4
const FIELD_HEIGHT = 6.2

interface Props {
  growth: GrowthProfile
  /** Escala DIBUJADA del árbol. El suelo la sigue para no despegarse de
   *  las raíces cuando la copa crece. La escribe GrowthRig. */
  escalaRef?: React.MutableRefObject<number>
  tema?: Tema
}

/**
 * Apariencia del aire en cada tema.
 *
 * En oscuro todo esto es luz aditiva y los valores son EXACTAMENTE los que
 * había: el modo oscuro no cambia un píxel.
 *
 * En claro es al revés, y el cambio de signo es el punto. Un halo de luz
 * sobre un fondo casi blanco no es tenue: no existe, porque sumar luz sobre
 * blanco da blanco. Lo que ancla un objeto a un piso claro no es un charco
 * de luz sino una SOMBRA. Así que en claro los mismos discos se dibujan con
 * mezcla normal y color oscuro, y pasan de ser el resplandor que sube de
 * las raíces a ser la sombra que el árbol proyecta.
 *
 * Las motas siguen el mismo camino: de polvo en suspensión iluminado a
 * polvo visto a contraluz, gris azulado y mucho más tenue.
 */
const APARIENCIA = {
  oscuro: {
    motas: { color: '#7dd3fc', base: 0.4, porBrillo: 0.16, tamano: 0.045 },
    telon: { opacidad: 0.55 },
    suelo: { color: '#ffffff', base: 0.45, porBrillo: 0.22 },
    contacto: { color: '#7cf0b4', base: 0.3, porBrillo: 0.3 },
  },
  claro: {
    /* Gris azulado frío: es el polvo a contraluz, no una partícula de
       color. Muy por debajo del oscuro porque sobre papel una mota tenue
       ya se ve, y setecientas manchas grises sobre blanco ensucian. */
    motas: { color: '#8fa8bf', base: 0.16, porBrillo: 0.05, tamano: 0.03 },
    /* Apagado. No es que se vea poco: en claro el telón es un plano casi
       blanco con mezcla normal que la órbita de la cámara pone DELANTE del
       árbol media vuelta de cada dos. Ver el comentario del <mesh>. */
    telon: { opacidad: 0 },
    /* La sombra proyectada. Es lo único que evita que el árbol flote. */
    suelo: { color: '#ffffff', base: 0.5, porBrillo: 0.12 },
    /* Y el contacto, más apretado: la sombra siempre es más densa justo
       donde el objeto toca el piso. Va en blanco como el disco grande
       porque el color ya lo trae la textura, y multiplicar dos veces por
       un azul oscuro devolvía una mancha negra. La densidad extra sale de
       apilar el mismo degradado, que es lo que hace una penumbra real. */
    contacto: { color: '#ffffff', base: 0.4, porBrillo: 0.12 },
  },
} as const

/**
 * Aire de la instalación: polvo en suspensión y el halo del suelo. Es lo
 * que da profundidad y hace que el árbol no flote en un vacío.
 */
export default function Atmosphere({ growth, escalaRef, tema = 'oscuro' }: Props) {
  const motesRef = useRef<THREE.Points>(null)
  const glow = useMemo(() => getGlowTexture(), [])
  const ap = APARIENCIA[tema]

  // Estado por partícula: posición base y velocidad de ascenso.
  const motes = useMemo(() => {
    const positions = new Float32Array(MAX_MOTES * 3)
    const speeds = new Float32Array(MAX_MOTES)
    const phases = new Float32Array(MAX_MOTES)

    for (let i = 0; i < MAX_MOTES; i++) {
      const angle = Math.random() * Math.PI * 2
      // Raíz cuadrada para que la distribución sea pareja en el disco.
      const radius = Math.sqrt(Math.random()) * FIELD_RADIUS
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = Math.random() * FIELD_HEIGHT - 1
      positions[i * 3 + 2] = Math.sin(angle) * radius
      speeds[i] = 0.05 + Math.random() * 0.16
      phases[i] = Math.random() * Math.PI * 2
    }

    return { positions, speeds, phases }
  }, [])

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(motes.positions.slice(), 3))
    return geo
  }, [motes])

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: glow,
        size: ap.motas.tamano,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
        color: new THREE.Color(ap.motas.color),
        opacity: 0.55,
        fog: false,
      }),
    [glow, tema, ap],
  )

  // Telón de fondo: la luz difusa que viene de fuera de cuadro en oscuro,
  // el degradado frío que despega el fondo del papel liso en claro.
  const backdropMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: makeBackdropTexture(tema),
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
        opacity: ap.telon.opacidad,
        // El telon esta detras del plano de niebla: si la recibe, se apaga.
        fog: false,
      }),
    [tema, ap],
  )

  const sueloRef = useRef<THREE.Group>(null)

  // Halo del suelo: ancla el árbol. En oscuro es la luz que sube de las
  // raíces; en claro, la sombra que el árbol proyecta.
  const groundTexture = useMemo(() => makeGroundTexture(tema), [tema])
  const groundMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: groundTexture,
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
        opacity: 0.7,
        color: new THREE.Color(ap.suelo.color),
        fog: false,
      }),
    [groundTexture, tema, ap],
  )

  /*
   * Halo de contacto: la misma textura radial, más chica y más concentrada.
   *
   * Reusa groundTexture a propósito: dos degradados distintos se leerían como
   * dos manchas superpuestas. Con la misma, el resultado es una sola pileta
   * —de luz en oscuro, de sombra en claro— que se intensifica hacia el
   * centro. Que la sombra sea más densa donde el tronco toca el piso es
   * exactamente lo que hace un contacto creíble.
   */
  const contactoMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: groundTexture,
        transparent: true,
        depthWrite: false,
        blending: blendingDe(tema),
        toneMapped: false,
        opacity: 0.45,
        color: new THREE.Color(ap.contacto.color),
        fog: false,
      }),
    [groundTexture, tema, ap],
  )

  useEffect(() => {
    const mesh = motesRef.current
    if (mesh) mesh.geometry.setDrawRange(0, growth.particleCount)
  }, [growth.particleCount])

  // Sin dispose() manual: rompería el montaje doble de StrictMode.
  // Ver la nota en TreeStructure.tsx.

  const timeRef = useRef(0)

  useFrame((_, delta) => {
    timeRef.current += delta
    const t = timeRef.current
    const pos = geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const active = Math.min(MAX_MOTES, growth.particleCount)

    for (let i = 0; i < active; i++) {
      const yi = i * 3 + 1
      arr[yi] += motes.speeds[i] * delta

      // Al pasarse de la copa vuelve abajo: campo infinito sin recrear buffers.
      if (arr[yi] > FIELD_HEIGHT) arr[yi] = -1

      // Deriva lateral suave, distinta por partícula.
      const phase = motes.phases[i]
      arr[i * 3] = motes.positions[i * 3] + Math.sin(t * 0.28 + phase) * 0.24
      arr[i * 3 + 2] = motes.positions[i * 3 + 2] + Math.cos(t * 0.22 + phase) * 0.24
    }

    pos.needsUpdate = true
    /*
     * Las opacidades salen de la apariencia del tema, no de constantes
     * sueltas. Escritas a mano acá, el modo claro se rompía en silencio:
     * el bucle pisaba cada cuadro lo que la tabla del tema acababa de
     * decidir, y la sombra del suelo volvía a los valores del resplandor.
     */
    material.opacity = ap.motas.base + growth.glowIntensity * ap.motas.porBrillo
    groundMaterial.opacity = ap.suelo.base + growth.glowIntensity * ap.suelo.porBrillo
    contactoMaterial.opacity = ap.contacto.base + growth.glowIntensity * ap.contacto.porBrillo

    /*
     * El suelo sigue al árbol.
     *
     * Se escala el grupo entero, así el disco crece y baja a la vez: en Brote
     * queda ajustado al pie del árbol y en Pleno acompaña la apertura de las
     * raíces sin dejarlas colgando ni atravesarlo.
     */
    const suelo = sueloRef.current
    if (suelo && escalaRef) {
      const e = escalaRef.current || 1
      suelo.scale.set(e, e, e)
    }
  })

  return (
    <group>
      {/*
        Telón de fondo. Un negro plano detrás del árbol lo deja flotando en
        la nada y delata que es una escena vacía; un halo tenue y descentrado
        da la sensación de aire y de una fuente de luz fuera de cuadro.

        SÓLO EN OSCURO, y el motivo es geométrico, no estético.

        El plano está clavado en z = -7 y la cámara ORBITA a un radio de
        ~8.5: media vuelta de cada vuelta lo deja entre la cámara y el
        árbol. Con mezcla aditiva eso no molesta —un plano aditivo delante
        sólo suma un velo de luz tenue, que es más o menos lo que el telón
        quiere hacer— pero con mezcla normal, que es lo que exige el fondo
        claro, un plano casi blanco al 50 % pasando por delante taparía el
        árbol entero durante la mitad de la órbita.

        En claro la profundidad ya la da la niebla, que se acerca a
        propósito (ver TreeScene), más la sombra del suelo. El telón no
        hace falta y no vale el riesgo.
      */}
      {ap.telon.opacidad > 0 && (
        <mesh position={[0.9, 2.4, -7]} material={backdropMaterial}>
          <planeGeometry args={[26, 18]} />
        </mesh>
      )}

      <points ref={motesRef} geometry={geometry} material={material} frustumCulled={false} />

      {/*
        El suelo, apoyado en las puntas de las raíces.

        Antes era un disco a una altura fija de -0.92. El árbol escala con la
        participación: en Brote las raíces llegan a -0.55 y el halo quedaba
        flotando medio metro por debajo, sin tocar nada; en Pleno bajan a
        -1.16 y las raíces atravesaban el suelo por abajo. En los dos casos
        se perdía lo único que este disco tiene que hacer, que es dar la
        sensación de que el árbol está apoyado en algo.

        Ahora la altura y el tamaño siguen la escala dibujada, así que el
        contacto se mantiene en cualquier etapa.
      */}
      <group ref={sueloRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.08, 0]} material={groundMaterial}>
          <circleGeometry args={[5.6, 64]} />
        </mesh>

        {/*
          Segundo halo, chico y apretado, justo donde las raíces se hunden.
          El disco grande da ambiente; este da CONTACTO. Sin él el árbol se
          lee sobre una mancha de luz, no dentro de ella.
        */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -1.02, 0]}
          material={contactoMaterial}
        >
          <circleGeometry args={[2.5, 48]} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * Telón de fondo: una mancha elíptica, descentrada y en diagonal.
 * Descentrada a propósito — un halo perfectamente centrado detrás del sujeto
 * se lee como viñeta de plantilla, no como iluminación de sala.
 *
 * En oscuro es luz azul que entra de fuera de cuadro. En claro son los
 * mismos azules de marca pero muy lavados y con mezcla normal: dejan de ser
 * una fuente de luz y pasan a ser el degradado frío que le saca el aspecto
 * de papel liso al fondo. El mismo encuadre descentrado sirve para las dos.
 */
function makeBackdropTexture(tema: Tema): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) return new THREE.Texture()

  const grad = ctx.createRadialGradient(
    size * 0.42,
    size * 0.38,
    0,
    size * 0.5,
    size * 0.5,
    size * 0.52,
  )

  if (tema === 'claro') {
    grad.addColorStop(0, 'rgba(214, 232, 250, 0.75)')
    grad.addColorStop(0.3, 'rgba(222, 236, 250, 0.5)')
    grad.addColorStop(0.62, 'rgba(233, 241, 249, 0.22)')
    grad.addColorStop(1, 'rgba(233, 241, 249, 0)')
  } else {
    grad.addColorStop(0, 'rgba(18, 111, 245, 0.34)')
    grad.addColorStop(0.3, 'rgba(40, 70, 159, 0.22)')
    grad.addColorStop(0.62, 'rgba(13, 63, 176, 0.08)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  }

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Disco radial del suelo, generado en canvas.
 *
 * En oscuro es el resplandor que sube de las raíces: verde en el centro,
 * abriéndose a los azules de marca.
 *
 * En claro es la SOMBRA proyectada, y por eso el degradado se invierte: va
 * de un azul-gris denso en el centro a transparente en el borde, con la
 * caída bastante más rápida. Una sombra real no se desvanece de manera
 * pareja hasta el infinito; tiene un núcleo y una penumbra corta.
 */
function makeGroundTexture(tema: Tema): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (!ctx) return new THREE.Texture()

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)

  if (tema === 'claro') {
    /*
     * La caída es mucho más rápida que la del resplandor, y no es una
     * cuestión de gusto: el disco mide 5.6 de radio y el árbol entero unas
     * 7 de ancho. Repartido pareja sobre esa superficie, un valor que
     * alcanza para un halo de luz da una mancha gris enorme y casi
     * transparente, que sobre papel no se lee como sombra sino como que la
     * pantalla está sucia. Una sombra real tiene núcleo y penumbra corta:
     * acá casi toda la densidad vive en el quinto interior del disco.
     */
    grad.addColorStop(0, 'rgba(30, 52, 74, 0.8)')
    grad.addColorStop(0.08, 'rgba(34, 58, 80, 0.66)')
    grad.addColorStop(0.2, 'rgba(52, 80, 106, 0.3)')
    grad.addColorStop(0.4, 'rgba(88, 116, 142, 0.1)')
    grad.addColorStop(0.68, 'rgba(120, 146, 170, 0.02)')
    grad.addColorStop(1, 'rgba(120, 146, 170, 0)')
  } else {
    grad.addColorStop(0, 'rgba(37, 211, 102, 0.5)')
    grad.addColorStop(0.16, 'rgba(18, 111, 245, 0.26)')
    grad.addColorStop(0.42, 'rgba(40, 70, 159, 0.12)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
  }

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
