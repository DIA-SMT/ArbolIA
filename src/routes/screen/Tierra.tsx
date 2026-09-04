import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tema } from './temaEscena'
import { curva } from './atardecer'

/**
 * La tierra: un velo en y=0 que se ve a través.
 *
 * POR QUÉ NO ES UN SUELO OPACO. Las raíces son la comunidad — la mitad de
 * lo que la instalación tiene para decir— y viven bajo tierra. La cámara
 * está SIEMPRE por encima de y=0 (mínimo medido: 0.97), así que un suelo
 * opaco a nivel del piso las taparía el 100 % del tiempo, en todas las
 * etapas y en toda la órbita: se perdería el 95 % del arco radicular y del
 * árbol de abajo sólo quedaría el cuello de las madres asomando.
 *
 * Así que la tierra es un VELO. Las raíces se ven a través de él, atenuadas
 * — que es exactamente la lectura del corte transversal de la foto de
 * referencia: se está mirando bajo tierra. El velo tapa lo que está por
 * debajo de y=0 y no toca nada de lo que está por encima, porque el rayo de
 * la cámara a un punto alto no cruza el plano.
 *
 * DÓNDE VA LA LÍNEA, Y POR QUÉ NO EN EL HORIZONTE.
 *
 * Un horizonte de verdad está a la altura del ojo. Medido en esta escena:
 * la línea del ojo cae al 38 % del alto de cuadro y la base del árbol al
 * 65,5 %. O sea que un horizonte físicamente correcto pasaría 27 puntos POR
 * ENCIMA del pie del árbol, cortando la copa por la mitad y dejando más de
 * medio árbol por debajo del nivel de la tierra. La línea que tenía que
 * decir "comunidad abajo, ideas arriba" diría que las ideas están
 * enterradas. En la foto de referencia el horizonte coincide con el pie del
 * árbol porque la cámara está a ras del piso; la nuestra mira desde arriba.
 *
 * Por eso la línea no es el horizonte del cielo: es el BORDE de este disco,
 * que es finito y está en y=0. Visto en ángulo rasante, el borde se escorza
 * solo y da una línea fina sin que haya que dibujarla.
 *
 * EL RADIO SE CALCULA POR CUADRO, y no es una optimización: es lo que hace
 * que la línea no se mueva. La cámara orbita cambiando de altura, y su
 * radio se mueve 4,1 veces entre Brote y Pleno porque el encuadre se
 * recalcula con la escala del árbol. Con un radio fijo, el borde subiría y
 * bajaría por el cuadro durante toda la feria. Fijando en cambio el ÁNGULO
 * DE DEPRESIÓN del borde respecto de la línea del ojo, la línea queda
 * clavada en la misma fracción de pantalla en cualquier etapa.
 */

/**
 * A cuántos grados por debajo de la línea del ojo queda el borde.
 *
 * El campo vertical es de 42°, así que cada grado son 2,38 puntos del alto
 * de cuadro. Con 6° el borde cae unos 14 puntos por debajo del ojo: en el
 * 52 % del cuadro, cómodamente por encima de la base del árbol (65,5 %) y
 * bien lejos de la línea del ojo (38 %). Ahí la tierra se lee como el plano
 * sobre el que está plantado el árbol y no como una faja que lo cruza.
 */
const DEPRESION_BORDE = (6 * Math.PI) / 180

/** Piso del radio: con la cámara muy baja la cuenta tiende a cero. */
const RADIO_MIN = 5

/**
 * Techo del radio. El plano lejano está en 60 y la cámara puede estar a
 * 30,3 del eje: sin tope, un borde muy lejano se recortaría contra el far
 * y aparecería un arco duro cruzando la tierra.
 */
const RADIO_MAX = 26

const APARIENCIA = {
  oscuro: {
    /*
     * En oscuro la tierra es apenas un tono más profundo que la noche, y
     * el velo es MUY tenue: bajo tierra el árbol tiene su resplandor verde
     * de raíces, que es de lo más lindo que hace la instalación, y un velo
     * cargado lo apagaría. Acá la tierra la cuenta sobre todo la línea del
     * borde, no la mancha.
     */
    color: '#050b16',
    opacidad: 0.5,
    /** Cuánto más marcada va la orilla respecto del resto del disco. */
    orilla: 2.2,
  },
  claro: {
    /*
     * Tierra ABSTRACTA, como se decidió: un azul pizarra desaturado de la
     * familia institucional, no una textura de barro. Un suelo fotográfico
     * metería un segundo idioma visual en una pantalla que tiene uno solo
     * —el mismo motivo por el que los animales son de luz y no de pelo—.
     */
    color: '#3d5468',
    opacidad: 0.42,
    orilla: 2.6,
  },
} as const

/**
 * Perfil radial del velo, horneado una vez.
 *
 * De adentro hacia afuera: denso bajo el árbol, aclarando hacia afuera
 * —así la tierra tiene profundidad y no es una calcomanía plana—, un
 * repunte en la orilla que ES la línea del horizonte, y un desvanecido
 * corto al final para que el polígono no termine en un filo duro.
 */
function crearPerfilDeTierra(orilla: number): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.Texture()

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  const a = (v: number) => `rgba(255,255,255,${Math.min(1, v).toFixed(3)})`

  g.addColorStop(0, a(1))
  g.addColorStop(0.35, a(0.86))
  g.addColorStop(0.72, a(0.62))
  // La orilla: el repunte que se lee como línea de horizonte.
  g.addColorStop(0.93, a(0.55))
  g.addColorStop(0.963, a(0.55 * orilla))
  g.addColorStop(0.982, a(0.34))
  g.addColorStop(1, a(0))

  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  // Es una máscara de densidad, no color: el color vive en el material.
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

export default function Tierra({
  tema = 'oscuro',
  faseRef,
}: {
  tema?: Tema
  /** Fase del atardecer: 0 día, 1 noche. Ver atardecer.ts. */
  faseRef?: React.MutableRefObject<number>
}) {
  const malla = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  /*
   * UNA sola textura para los dos temas, y un solo material.
   *
   * El perfil se horneaba con ap.orilla, así que cada Ctrl+L regeneraba un
   * canvas de 512x512 y construía un material nuevo. Con un atardecer eso
   * sería un tirón justo en el momento que tiene que pasar desapercibido.
   * Los dos valores de orilla —2.2 y 2.6— dan una línea prácticamente
   * igual, así que se hornea una sola vez con el punto medio y lo que
   * cambia con la fase es el color y la opacidad, que son escalares.
   */
  const perfil = useMemo(() => crearPerfilDeTierra(2.4), [])
  const dia = useMemo(() => new THREE.Color(APARIENCIA.claro.color), [])
  const noche = useMemo(() => new THREE.Color(APARIENCIA.oscuro.color), [])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: perfil,
        color: new THREE.Color(),
        transparent: true,
        opacity: 1,
        /*
         * NO escribe profundidad: si la escribiera, taparía por z-buffer
         * todo lo que está bajo tierra y volveríamos al suelo opaco que
         * esta pieza existe para evitar.
         *
         * Sí LEE profundidad, y eso es lo que hace que el velo caiga sólo
         * sobre el subsuelo: donde el tronco está delante del plano, la
         * prueba de profundidad rechaza al velo y el árbol queda limpio.
         */
        depthWrite: false,
        depthTest: true,
        // Mezcla normal en los dos temas: es tierra, no luz. Ni siquiera en
        // oscuro puede ser aditiva — sumar luz no oscurece nada.
        blending: THREE.NormalBlending,
        toneMapped: false,
        // La niebla la desdibujaría justo en la orilla, que es la línea.
        fog: false,
        side: THREE.DoubleSide,
      }),
    [perfil],
  )

  useFrame(() => {
    const m = malla.current
    if (!m) return

    /*
     * La tierra se oscurece con el atardecer. Es lo único de esta pieza que
     * cambia con el tema, y es puro escalar: color y opacidad sobre un
     * material que se creó una vez.
     */
    const f = curva(faseRef ? faseRef.current : tema === 'oscuro' ? 1 : 0)
    material.color.lerpColors(dia, noche, f)
    material.opacity = THREE.MathUtils.lerp(
      APARIENCIA.claro.opacidad,
      APARIENCIA.oscuro.opacidad,
      f,
    )

    /*
     * Radio para que el borde caiga siempre a DEPRESION_BORDE bajo la
     * línea del ojo.
     *
     *   d = altura de la cámara / tan(depresión)     distancia horizontal
     *   R = d - distancia horizontal de la cámara al eje
     */
    const alturaCamara = Math.max(0.2, camera.position.y)
    const distEje = Math.hypot(camera.position.x, camera.position.z)
    const d = alturaCamara / Math.tan(DEPRESION_BORDE)
    const radio = THREE.MathUtils.clamp(d - distEje, RADIO_MIN, RADIO_MAX)

    /*
     * Suavizado fuerte hacia el radio objetivo. La altura de la cámara
     * oscila y el radio objetivo con ella; sin suavizar, la orilla
     * tembletea. Con el lerp el ajuste es continuo y no se percibe.
     */
    const actual = m.scale.x
    m.scale.setScalar(actual + (radio - actual) * 0.06)
  })

  return (
    <mesh
      ref={malla}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      /*
       * y = 0 EXACTO, y fuera de GrowthRig.
       *
       * El origen es el punto fijo del escalado del árbol, así que y=0
       * sigue siendo el nivel del suelo en cualquier etapa. Metido adentro
       * de GrowthRig a una altura distinta de cero, el horizonte subiría y
       * bajaría solo a lo largo de la jornada.
       */
      position={[0, 0, 0]}
      /*
       * Antes que el resto de lo transparente. La copa, las motas, los
       * bichos y la partícula van después y el velo no los toca; lo opaco
       * —tronco y raíces— ya se dibujó, así que el velo cae sobre ellos,
       * que es su trabajo. Sin esto, el ordenamiento de transparentes usa
       * el centro de cada objeto y este disco, centrado en el origen,
       * podría terminar dibujándose encima de las hojas.
       */
      renderOrder={-100}
      frustumCulled={false}
      scale={12}
    >
      <circleGeometry args={[1, 128]} />
    </mesh>
  )
}
