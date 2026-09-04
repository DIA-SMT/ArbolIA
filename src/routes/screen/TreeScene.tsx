import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { BlendFunction, type BloomEffect } from 'postprocessing'
import * as THREE from 'three'
import TreeStructure from './TreeStructure'
import Leaves from './Leaves'
import Journey from './Journey'
import FallingFruit from './FallingFruit'
import Atmosphere from './Atmosphere'
import CelebrationBurst from './CelebrationBurst'
import FloatingLabels from './FloatingLabels'
import Pajaro from './Pajaro'
import Ardilla from './Ardilla'
import Perrito from './Perrito'
import Sol from './Sol'
import Cielo from './Cielo'
import Tierra from './Tierra'
import Diagnostics, { type DiagInfo } from './Diagnostics'
import { CIELO } from './temaEscena'
import type { GrowthProfile, Idea } from '../../lib/types'

interface Props {
  /** Sólo las que ocupan hoja. Único conteo válido para los slots. */
  propuestas: Idea[]
  activeIdea: Idea | null
  /** Crítica cayendo hacia las raíces, o null. */
  criticaCayendo: Idea | null
  /** Sube de a uno cuando una crítica toca la tierra. */
  pulsoRaices: number
  /** Fondo de la escena. El árbol conserva sus colores en los dos. */
  tema: 'claro' | 'oscuro'
  growth: GrowthProfile
  celebration: number | null
  quality: 'alta' | 'media'
  /** Ctrl+H del operador: oculta el texto sin frenar la instalacion. */
  labelsVisible: boolean
  /** Permite apagar el postprocesado (?fx=off) para aislar problemas. */
  postprocessing: boolean
  onDiagnostics?: (d: DiagInfo) => void
}

export default function TreeScene({
  propuestas,
  activeIdea,
  criticaCayendo,
  pulsoRaices,
  tema,
  growth,
  celebration,
  quality,
  labelsVisible,
  postprocessing,
  onDiagnostics,
}: Props) {
  // Cuántas hojas de la categoría entrante ya están plantadas: define el slot
  // exacto al que va a viajar la partícula.
  // Se cuenta sobre `propuestas`, NUNCA sobre `ideas`: una crítica no
  // ocupa slot, y contarla acá correría todas las hojas de esa rama.
  const indexInCategory = useMemo(() => {
    if (!activeIdea) return 0
    return propuestas.reduce((n, i) => (i.category === activeIdea.category ? n + 1 : n), 0)
  }, [propuestas, activeIdea])

  const bloomRef = useRef<BloomEffect | null>(null)

  /*
   * La escala que el árbol tiene DIBUJADA en este cuadro.
   *
   * La escribe GrowthRig y la lee la cámara. Va por referencia y no por
   * prop porque lo que le importa a la cámara no es a qué escala tiende el
   * árbol sino cuál tiene ahora: GrowthRig interpola muy lento hacia el
   * objetivo, y encuadrar contra el objetivo dejaría a la cámara adelantada
   * al árbol durante toda la transición.
   */
  const escalaRef = useRef(growth.canopyScale)

  return (
    <>
      {/*
        El fondo sigue al tema; el árbol no.

        Sus colores vienen de las ocho áreas y del verde institucional: son
        identidad, no decoración, y cambiarlos sería otra instalación. Lo
        que cambia es sobre qué está.

        En claro la niebla se acerca un poco: sobre fondo oscuro difumina
        la profundidad, sobre fondo claro tiene que dibujar el contorno o
        las ramas del fondo se pierden contra el blanco.
      */}
      <color attach="background" args={[CIELO[tema].fondo]} />
      <fog
        attach="fog"
        args={[CIELO[tema].niebla, CIELO[tema].cerca, CIELO[tema].lejos]}
      />

      <CameraRig celebration={celebration} escalaRef={escalaRef} />

      {/*
        El cielo va ANTES que la atmósfera y fuera de GrowthRig: está pegado
        al ojo, no al árbol, y no crece con él. Ver Cielo.tsx.
      */}
      <Cielo tema={tema} />

      <Atmosphere growth={growth} escalaRef={escalaRef} tema={tema} />

      {/*
        La tierra tambien va fuera de GrowthRig: y=0 es el punto fijo del
        escalado, asi que el nivel del suelo no se mueve cuando el arbol
        crece. Ver Tierra.tsx.
      */}
      <Tierra tema={tema} />

      {/*
        Todo el árbol vive dentro del mismo grupo escalado: estructura,
        follaje, partícula y etiquetas crecen juntos. Si escalara sólo la
        estructura, las hojas quedarían flotando fuera de sus ramas.
      */}
      <GrowthRig scale={growth.canopyScale} escalaRef={escalaRef}>
        <TreeStructure
          growth={growth}
          highlightSlug={activeIdea?.category ?? null}
          pulsoRaices={pulsoRaices}
          tema={tema}
        />
        <Leaves ideas={propuestas} growth={growth} quality={quality} tema={tema} />
        <Journey idea={activeIdea} indexInCategory={indexInCategory} tema={tema} />

        {/*
          PROTOTIPO (rama animales): un pájaro de luz que cruza cada tanto.
          Va dentro del grupo escalado para que acompañe al árbol en
          cualquier etapa. En desarrollo se lo puede disparar a mano con
          __arbolia_pajaro.volar().
        */}
        <Pajaro tema={tema} />
        <Ardilla tema={tema} />
        <Perrito tema={tema} />
        <Sol tema={tema} />

        {/* La crítica hace el camino inverso: cae y alimenta las raíces. */}
        <FallingFruit idea={criticaCayendo} visible={labelsVisible} tema={tema} />
        {/*
          Sólo las propuestas cuelgan de la copa.

          Una crítica muestra su texto mientras cae, y cuando toca las
          raíces se termina: no vuelve a la rotación. Si siguiera colgada
          arriba diría lo contrario de lo que hace la instalación — el
          reclamo no vive en las ramas, alimenta la base.
        */}
        <FloatingLabels ideas={propuestas} visible={labelsVisible} />
        <CelebrationBurst trigger={celebration} tema={tema} />
      </GrowthRig>

      {onDiagnostics && <Diagnostics onSample={onDiagnostics} />}

      {/*
        EL POSTPROCESADO NO ES EL MISMO EN LOS DOS TEMAS, y no es una
        preferencia estética: en claro el de abajo destruía la imagen.

        El bloom toma todo lo que supere uLuminanceThreshold = 0.16. El
        fondo del tema claro es #f7fafd, luminancia 0.978: el fondo ENTERO
        pasa el umbral, así que el efecto difuminaba el fondo por encima del
        árbol. Esa era la neblina lechosa que se comía la copa, las
        etiquetas y las ramas finas. No hay umbral que lo arregle —tendría
        que estar por encima de 0.978 y ahí no atrapa nada— porque el bloom
        es, por definición, luz que desborda sobre lo oscuro. Sobre papel no
        hay nada que desborde.

        La viñeta se queda en los dos, pero muy bajada en claro: a 0.62
        sobre blanco no se lee como profundidad, se lee como suciedad en las
        esquinas.

        Comprobado con ?fx=off, que ya existía para aislar exactamente esto.
      */}
      {postprocessing && tema === 'claro' && (
        <EffectComposer multisampling={0}>
          <Vignette eskil={false} offset={0.42} darkness={0.22} blendFunction={BlendFunction.NORMAL} />
        </EffectComposer>
      )}

      {postprocessing && tema === 'oscuro' && (
        <>
          {/*
            El driver del bloom va FUERA del composer. EffectComposer arma su
            pasada a partir de los objetos hijos, así que sus hijos directos
            deben ser efectos y nada más; un componente propio en el medio es
            un buen modo de quedarse sin imagen.
          */}
          <BloomDriver target={bloomRef} celebration={celebration} growth={growth} />

          {/*
            SIN MSAA, y es una decisión medida.

            Estaba en 2x para la calidad alta. Medido en la PC del stand —una
            Intel UHD integrada moviendo 1920x1080— con el árbol al máximo:

              alta + bloom + MSAA 2x    20,7 ms   ->  no entra en 60 Hz
              alta + bloom, sin MSAA    14,1 ms   ->  entra
              media + bloom             12,3 ms   ->  entra, con medio follaje

            Un LED a 60 Hz da 16,7 ms por cuadro. Con 20,7 se pierde un vsync
            de cada dos y la instalación corre a 30 fps: el MSAA solo se
            llevaba 6,6 ms, un tercio del cuadro.

            Apagarlo deja el árbol COMPLETO, con su resplandor, a 60 fps. Es
            mejor resultado que dejar actuar al guardián, que para llegar a
            60 baja a calidad media y cuesta la mitad del follaje.

            La contra es que no queda antialias en ningún lado: el canvas ya
            venía con antialias:false. En esta escena pesa poco, porque es
            resplandor aditivo sobre fondo profundo y el bloom difumina los
            bordes; lo que puede notarse son las ramas finas oscuras.
          */}
          <EffectComposer multisampling={0}>
            <Bloom
              ref={bloomRef}
              intensity={0.85}
              luminanceThreshold={0.16}
              luminanceSmoothing={0.36}
              mipmapBlur
              radius={quality === 'alta' ? 0.72 : 0.55}
            />
            <Vignette eskil={false} offset={0.28} darkness={0.62} blendFunction={BlendFunction.NORMAL} />
          </EffectComposer>
        </>
      )}
    </>
  )
}

/**
 * Escala del árbol según la etapa de crecimiento.
 *
 * El origen está en la base del tronco, así que escalar desde ahí mantiene
 * el pie apoyado y hace crecer la copa hacia arriba y las raíces hacia
 * abajo, que es como crece un árbol.
 *
 * La interpolación es muy lenta a propósito: entre una idea y la siguiente
 * el cambio de escala es imperceptible, y a lo largo de una jornada de expo
 * el árbol se agranda de verdad. Un salto de tamaño al cruzar el umbral de
 * una etapa se leería como un error de render.
 */
function GrowthRig({
  scale,
  escalaRef,
  children,
}: {
  scale: number
  escalaRef: React.MutableRefObject<number>
  children: React.ReactNode
}) {
  const ref = useRef<THREE.Group>(null)
  const readyRef = useRef(false)

  useFrame(() => {
    const group = ref.current
    if (!group) return

    // El primer cuadro toma el valor exacto: al cargar no se ve "crecer"
    // desde cero un árbol que ya tiene doscientas ideas.
    if (!readyRef.current) {
      group.scale.setScalar(scale)
      escalaRef.current = scale
      readyRef.current = true
      return
    }

    group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, scale, 0.01))
    escalaRef.current = group.scale.x
  })

  return <group ref={ref}>{children}</group>
}

/*
 * Medidas del árbol a escala 1, para poder encuadrarlo.
 *
 * Salen de medir la instalación corriendo: se proyectaron 13.000 vértices
 * de la madera y centros de hoja sobre 128 posiciones de cámara —toda la
 * órbita, con las oscilaciones de radio y altura en sus extremos— y se
 * buscó el par que deja los márgenes más parejos.
 *
 * ALTO_UNITARIO sí es la altura real de la silueta. CENTRO_UNITARIO NO es
 * el centro geométrico: es el punto de mira que equilibra
 * el cuadro. La diferencia es perspectiva pura — la cámara mira casi a la
 * altura del árbol, así que las raíces quedan cerca y proyectan hacia abajo
 * mucho más de lo que su tamaño sugiere. Apuntando al centro geométrico el
 * margen de abajo se iba a -1.7% y el árbol se cortaba.
 *
 * Con estos valores: 10.6% de margen arriba y 11.1% abajo en el peor
 * cuadro de la órbita. Si cambia la geometría del árbol hay que volver a
 * medirlas, y el síntoma de que quedaron viejas es que se descentre.
 */
const ALTO_UNITARIO = 6.64
const CENTRO_UNITARIO = 1.8

/** Rango de canopyScale entre Brote y Pleno. Ver stagesFor() en growth.ts. */
const ESCALA_MIN = 0.52
const ESCALA_MAX = 1.3

/** Cuánto del alto del cuadro ocupa el árbol en cada extremo del rango. */
const LLENADO_MIN = 0.56
const LLENADO_MAX = 0.7

/**
 * Ancho del árbol en unidades de modelo, como ALTO_UNITARIO es su alto.
 *
 * No sale de la geometría a mano: medirla incluye el disco de suelo, que es
 * mucho más ancho que la copa y arrastraría el valor al doble. Se derivó de
 * la pantalla: a la distancia de encuadre medida, el árbol ocupaba el 97 %
 * del ancho del LED vertical, lo que da 7.2 unidades de modelo. Coherente
 * con un alto de 6.64: la copa es apenas más ancha que alta.
 *
 * Si se cambia la ramificación del árbol, este número hay que volver a
 * medirlo. El síntoma de que quedó corto es la copa tocando los bordes.
 */
const ANCHO_UNITARIO = 7.2

/** Cuánto del ANCHO ocupa el árbol cuando el encuadre lo decide el ancho. */
const LLENADO_ANCHO = 0.92

/**
 * Órbita lenta y continua alrededor del árbol.
 *
 * Un plano fijo se lee como una imagen; el movimiento sostenido es lo que
 * hace que alguien que pasa de reojo gire la cabeza. La vuelta completa
 * demora ~100 s: se nota que está vivo, pero no marea a quien mira un rato.
 */
function CameraRig({
  celebration,
  escalaRef,
}: {
  celebration: number | null
  escalaRef: React.MutableRefObject<number>
}) {
  const { camera, size } = useThree()
  const timeRef = useRef(0)
  const celebrationRef = useRef(0)
  const lastCelebration = useRef<number | null>(null)
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  if (celebration !== lastCelebration.current) {
    lastCelebration.current = celebration
    if (celebration !== null) celebrationRef.current = 1
  }

  useFrame((_, delta) => {
    timeRef.current += delta
    const t = timeRef.current

    celebrationRef.current = Math.max(0, celebrationRef.current - delta / 5)
    const celebrating = celebrationRef.current

    /*
     * La órbita no es uniforme a propósito.
     *
     * Una vuelta a velocidad constante en un círculo perfecto se lee como
     * un objeto en un visor de modelos 3D. Sumarle una oscilación lenta a la
     * velocidad angular, y desfasar la altura respecto del radio, hace que
     * el movimiento parezca intención y no un motor girando.
     */
    /*
     * El encuadre se calcula, no se fija.
     *
     * Antes eran dos números quietos —mirar a y=2.05 desde un radio de 7— y
     * eso encuadraba UNA sola escala del árbol. El problema es que el árbol
     * cambia de tamaño durante la feria: canopyScale va de 0.52 en Brote a
     * 1.3 en Pleno, dos veces y media. Medido con 14 ideas, o sea en el
     * tamaño MÍNIMO, la silueta ya ocupaba el 64% del alto y tocaba el borde
     * de abajo: el abanico de raíces estaba cortado. Con la feria andando el
     * árbol se salía del cuadro por completo.
     *
     * Ahora la cámara despeja la distancia a la que el árbol ocupa la
     * fracción de pantalla que queremos, y mira a su centro real. Las dos
     * cosas dependen de la escala dibujada, así que el encuadre se sostiene
     * en cualquier etapa.
     *
     * Que la fracción crezca con la escala —0.70 en Brote, 0.88 en Pleno— es
     * a propósito: si fuera constante, el árbol tendría exactamente el mismo
     * tamaño en pantalla con 10 ideas que con 3000 y se perdería lo único
     * que la instalación tiene para contar. Así crece, pero acotado.
     */
    const escala = escalaRef.current
    const alto = ALTO_UNITARIO * escala
    const centro = CENTRO_UNITARIO * escala

    const avance = THREE.MathUtils.clamp(
      (escala - ESCALA_MIN) / (ESCALA_MAX - ESCALA_MIN),
      0,
      1,
    )
    const relleno = THREE.MathUtils.lerp(LLENADO_MIN, LLENADO_MAX, avance)

    /*
     * EL ENCUADRE MIRA LOS DOS EJES, y el motivo es el LED del stand.
     *
     * Acá sólo se encuadraba por alto, con este razonamiento: el fov de
     * three es VERTICAL, así que la cuenta no depende de si el LED es 16:9 o
     * más ancho. Es cierto mientras la pantalla sea apaisada. El LED del
     * stand está montado en VERTICAL, y ahí se rompe.
     *
     * El campo horizontal sale de fovH = 2*atan(tan(fov/2) * aspecto). Con
     * fov 42 son 68.6° en 1920x1080 y apenas 24.4° en 1080x1920: un tercio.
     * Encuadrando sólo por alto, el árbol se salía por los costados —medido
     * en la pantalla real, tocaba el borde izquierdo— y además ocupaba el
     * 96 % del alto, así que no quedaba una sola franja libre para los datos
     * y el overlay terminaba escrito encima de la copa.
     *
     * Con el max() manda la distancia más lejana de las dos. En apaisado
     * gana la de alto por amplio margen, así que el LED horizontal queda
     * EXACTAMENTE como estaba. En vertical gana la de ancho: el árbol entra
     * entero y su alto en pantalla baja a poco más de la mitad, que es lo
     * que libera las bandas de arriba y de abajo.
     */
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 42
    const tanV = Math.tan((fov * Math.PI) / 360)
    const aspecto = size.width / Math.max(1, size.height)

    const distanciaPorAlto = alto / (2 * relleno * tanV)
    const ancho = ANCHO_UNITARIO * escala
    const distanciaPorAncho = ancho / (2 * LLENADO_ANCHO * tanV * aspecto)

    const radioBase = Math.max(distanciaPorAlto, distanciaPorAncho)

    target.y = centro

    const angle = t * 0.055 + Math.sin(t * 0.083) * 0.34
    // Las oscilaciones van en proporción al radio, no en unidades fijas: con
    // el árbol chico la cámara está cerca y medio metro se nota el triple.
    const radius = radioBase * (1 + Math.sin(t * 0.117 + 1.4) * 0.078 + celebrating * 0.21)
    const height = target.y + radioBase * (0.064 + Math.sin(t * 0.071) * 0.06 + celebrating * 0.07)

    camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)

    // El punto de mira también deriva: la copa no queda clavada en el centro.
    const deriva = alto * 0.035
    camera.lookAt(
      target.x + Math.sin(t * 0.047) * deriva,
      target.y + Math.sin(t * 0.061) * deriva * 0.75,
      target.z + Math.cos(t * 0.053) * deriva,
    )
  })

  return null
}

/**
 * Sube el bloom durante los hitos y lo acompaña con la etapa de crecimiento.
 *
 * Es un componente sin geometría que sólo muta el efecto por referencia. Vive
 * fuera del EffectComposer a propósito: el composer arma su pasada con los
 * objetos que cuelgan de él y espera efectos, no componentes cualquiera.
 */
function BloomDriver({
  target,
  celebration,
  growth,
}: {
  target: React.RefObject<BloomEffect | null>
  celebration: number | null
  growth: GrowthProfile
}) {
  const boostRef = useRef(0)
  const lastCelebration = useRef<number | null>(null)

  if (celebration !== lastCelebration.current) {
    lastCelebration.current = celebration
    if (celebration !== null) boostRef.current = 1
  }

  useFrame((_, delta) => {
    boostRef.current = Math.max(0, boostRef.current - delta / 4.2)
    const effect = target.current
    if (!effect) return

    const base = 0.62 + growth.glowIntensity * 0.28
    effect.intensity = base + boostRef.current * 1.5
  })

  return null
}
