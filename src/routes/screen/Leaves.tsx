import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getLeafGeometry, getLeafTexture } from './leafAssets'
import { getTreeModel } from './treeGeometry'
import { leafQuaternion, placeAll, placeLeaf, type PlacedLeaf } from './leafPlacement'
import { WIND_GLSL, windUniforms } from './windShader'
import { type Tema } from './temaEscena'
import type { GrowthProfile, Idea } from '../../lib/types'

/*
 * Techos de dibujo del follaje.
 *
 * Se subieron para que la copa se lea como masa y no como racimos sueltos.
 * El costo es relleno de pixeles, que es justo lo que escasea en la placa
 * integrada del stand, asi que MAX_AMBIENT es el techo en calidad alta y
 * en media se dibuja la mitad: si el LED se entrecorta, el operador baja
 * la calidad y recupera cuadros sin que nadie toque codigo.
 *
 * El de las ciudadanas no se recorta por calidad: son las hojas de las
 * personas que participaron y no pueden desaparecer por rendimiento.
 */
const MAX_LEAVES = 3000
const MAX_AMBIENT = 16000
/** Duración del brote de una hoja recién integrada. */
const SPROUT_MS = 1100
/** Las hojas ciudadanas van mas grandes que el follaje base: tienen que
 *  distinguirse dentro de la masa, no perderse en ella. */
const CITIZEN_SCALE = 1.34

interface Props {
  ideas: Idea[]
  growth: GrowthProfile
  /** En media se dibuja la mitad del follaje de ambiente. */
  quality: 'alta' | 'media'
  /** Fondo sobre el que va la copa. Cambia el valor, nunca el tono. */
  tema?: Tema
}

/**
 * Techo de luminosidad de una hoja ciudadana sobre fondo claro.
 *
 * Las hojas de ambiente ya salen oscuras: su fórmula las multiplica por
 * 0.52 y las hunde más hacia adentro del racimo, así que sobre papel se
 * leen bien tal cual. Las ciudadanas no: llevan el color de área casi
 * puro, y esos ocho hex están elegidos para brillar sobre negro. El rosa
 * de Cultura (#f9a8d4) tiene luminosidad HSL 0.82 y el fondo claro
 * (#f7fafd) 0.98: la hoja de una vecina, que es LO que la instalación
 * tiene para mostrar, quedaba a dieciséis centésimas del fondo.
 *
 * El tono no se toca —es lo que dice de qué habla la idea— y la
 * saturación sube apenas, para compensar que el mismo color a menor
 * luminosidad se percibe más lavado.
 */
const TECHO_L_CLARO = 0.46

/**
 * Escribe en `destino` el color de `origen` adaptado al fondo.
 *
 * Va a un destino aparte y no muta el original a propósito: leaf.color es
 * el color propio de la hoja de esa persona, calculado una vez desde su id
 * y conservado entre recargas. Si el tinte del tema se le aplicara encima,
 * volver a oscuro con Ctrl+L devolvería la copa apagada para siempre.
 */
function segunFondo(destino: THREE.Color, origen: THREE.Color, tema: Tema): THREE.Color {
  destino.copy(origen)
  if (tema === 'oscuro') return destino
  const hsl = { h: 0, s: 0, l: 0 }
  destino.getHSL(hsl)
  if (hsl.l <= TECHO_L_CLARO) return destino
  return destino.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.05), TECHO_L_CLARO)
}

/**
 * Follaje del árbol en dos capas instanciadas:
 *
 *  1. Ambiente — hojas tenues cuya cantidad sale de la etapa de crecimiento.
 *     Con cero ideas son CERO: el árbol arranca pelado y se llena a lo largo
 *     de la feria. Acá decía que un árbol pelado "genera lástima" y que por
 *     eso el follaje existía desde el minuto cero; se cambió por pedido del
 *     equipo y el motivo está explicado en growth.ts, donde vive el número.
 *  2. Ciudadanas — una por idea recibida, con el color de su categoría y
 *     un brillo muy por encima del ambiente. Son las que se ven.
 *
 * Son mallas SEPARADAS, con geometría y material propios: la cantidad de
 * ambiente no puede borrar ni escalar una hoja ciudadana.
 */
export default function Leaves({ ideas, growth, quality, tema = 'oscuro' }: Props) {
  const citizenRef = useRef<THREE.InstancedMesh>(null)
  const ambientRef = useRef<THREE.InstancedMesh>(null)

  /*
   * Una geometría por malla, no la compartida.
   *
   * aFlex es un atributo POR INSTANCIA, así que vive en la geometría. Las
   * dos mallas tienen distinta cantidad de instancias y distintos valores,
   * de modo que colgarlo de la geometría común las pisaría entre sí.
   */
  const ambientGeometry = useMemo(() => withFlexAttribute(MAX_AMBIENT), [])
  const citizenGeometry = useMemo(() => withFlexAttribute(MAX_LEAVES), [])
  const model = useMemo(() => getTreeModel(), [])

  // Estado de colocación entre renders.
  const placedRef = useRef<PlacedLeaf[]>([])
  const idsRef = useRef<string[]>([])
  const sproutRef = useRef<Map<number, number>>(new Map())
  const clockRef = useRef(0)
  /** Con qué tema se pintaron las hojas que ya están en la copa. */
  const temaVisto = useRef<Tema>(tema)

  const material = useMemo(() => makeLeafMaterial(getLeafTexture()), [])
  // Follaje base: opaco. Miles de hojas translucidas superpuestas se leen
  // como niebla verde, no como copa. El volumen lo da el color, no el alfa.
  const ambientMaterial = useMemo(() => makeLeafMaterial(getLeafTexture()), [])

  // ---- Follaje de ambiente: se coloca una sola vez -------------------
  useLayoutEffect(() => {
    const mesh = ambientRef.current
    if (!mesh) return

    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const hsl = { h: 0, s: 0, l: 0 }
    const flex = ambientGeometry.getAttribute('aFlex') as THREE.InstancedBufferAttribute

    // Un color por área, resuelto una sola vez.
    const branchColors = model.branches.map((b) => new THREE.Color(b.color))

    model.ambientSlots.forEach((slot, i) => {
      if (i >= MAX_AMBIENT) return

      dummy.position.copy(slot.position)
      dummy.quaternion.copy(leafQuaternion(slot, `ambient-${i}`))
      dummy.scale.setScalar(slot.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      /*
       * Tinte por área, oscurecido hacia adentro del racimo.
       *
       * Es lo que produce el degradado por sector: cada zona de la copa
       * lleva el color de su categoría. Y el sombreado por profundidad le
       * da bulto — una masa de follaje de un solo valor se ve como una
       * calcomanía pegada sobre las ramas.
       */
      color.copy(branchColors[slot.branch] ?? branchColors[0])
      color.getHSL(hsl)
      color.setHSL(
        (hsl.h + ((i % 13) - 6) * 0.0045 + 1) % 1,
        Math.min(1, hsl.s * (0.6 + (i % 7) * 0.022)),
        hsl.l * (0.52 - slot.depth * 0.28) * (0.86 + (i % 5) * 0.045),
      )
      mesh.setColorAt(i, color)
      flex.setX(i, slot.flex)
    })

    mesh.instanceMatrix.needsUpdate = true
    flex.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [model, ambientGeometry])

  /*
   * La densidad del follaje base sube con la etapa de crecimiento.
   *
   * El objetivo se guarda acá y lo persigue el useFrame de abajo, en vez de
   * escribirse de una. Antes esto asignaba mesh.count directo, y con follaje
   * de arranque no importaba: el escalón de una idea eran 96 hojas nuevas
   * sobre 9.280 ya presentes, invisible.
   *
   * Con el árbol arrancando pelado el escalón se ve. Cada idea mueve la
   * densidad 0.3/tramo, que con meta 500 son ~48 hojas y con meta 100 son
   * 240: doscientas cuarenta hojas apareciendo en un cuadro se leen como un
   * parpadeo, no como algo que crece.
   */
  const objetivoAmbiente = useRef(0)

  useLayoutEffect(() => {
    const techo = quality === 'alta' ? MAX_AMBIENT : Math.round(MAX_AMBIENT * 0.5)
    objetivoAmbiente.current = Math.min(
      techo,
      Math.round(techo * Math.min(1, Math.max(0, growth.foliageDensity))),
    )
  }, [growth.foliageDensity, quality])

  /*
   * Las hojas de ambiente brotan de a poco hasta alcanzar el objetivo.
   *
   * Se avanza por proporción y no por cantidad fija: así el tramo largo del
   * principio —de cero a las primeras miles— se recorre rápido, y los ajustes
   * finos de después no se arrastran. El piso de 1 garantiza que siempre
   * termine de llegar, y el techo por cuadro evita que un salto grande de
   * densidad se dibuje de golpe.
   *
   * El barajado de los slots (ver treeGeometry) es lo que hace que las hojas
   * nuevas caigan repartidas por toda la copa en vez de amontonarse en una
   * rama: sin eso, crecer de a poco se vería como una mancha.
   */
  useFrame((_, delta) => {
    const mesh = ambientRef.current
    if (!mesh) return
    const objetivo = objetivoAmbiente.current
    if (mesh.count === objetivo) return

    const falta = objetivo - mesh.count
    const paso = Math.max(1, Math.round(Math.abs(falta) * Math.min(1, delta * 1.6)))
    mesh.count = falta > 0
      ? Math.min(objetivo, mesh.count + paso)
      : Math.max(objetivo, mesh.count - paso)
  })

  // ---- Hojas ciudadanas ---------------------------------------------
  useLayoutEffect(() => {
    const mesh = citizenRef.current
    if (!mesh) return

    const previous = idsRef.current
    const nextIds = ideas.map((i) => i.id)

    /*
     * Un cambio de tema obliga a repintar la copa entera.
     *
     * Sin esto el efecto se saltea el trabajo: los ids son los mismos, así
     * que da append puro de largo cero y sale por el return de abajo sin
     * tocar un color. Las hojas ya plantadas se quedaban con el tinte del
     * tema anterior y sólo las que llegaran después nacían con el nuevo:
     * media copa de cada uno.
     */
    const cambioDeTema = temaVisto.current !== tema
    temaVisto.current = tema

    // ¿Es un append puro? (el caso normal: llegó una idea nueva)
    const isAppend =
      !cambioDeTema &&
      nextIds.length >= previous.length &&
      previous.every((id, index) => nextIds[index] === id)

    const dummy = new THREE.Object3D()
    const flex = citizenGeometry.getAttribute('aFlex') as THREE.InstancedBufferAttribute

    if (!isAppend) {
      // Cambió el conjunto (moderación retiró una hoja, o hubo reinicio):
      // recalculamos toda la copa. Es raro y cuesta pocos milisegundos.
      const { leaves } = placeAll(ideas)
      placedRef.current = leaves
      sproutRef.current.clear()

      leaves.forEach((leaf, i) => {
        if (i >= MAX_LEAVES) return
        applyLeaf(mesh, flex, dummy, leaf, i, 1, tema)
      })
      mesh.count = Math.min(leaves.length, MAX_LEAVES)
      mesh.instanceMatrix.needsUpdate = true
      flex.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      idsRef.current = nextIds
      return
    }

    if (nextIds.length === previous.length) return

    // Append: colocamos sólo las nuevas y las marcamos para brotar.
    const counters: Record<string, number> = {}
    placedRef.current.forEach((leaf) => {
      counters[leaf.category] = (counters[leaf.category] ?? 0) + 1
    })

    for (let i = previous.length; i < ideas.length; i++) {
      if (i >= MAX_LEAVES) break
      const idea = ideas[i]
      const n = counters[idea.category] ?? 0
      counters[idea.category] = n + 1

      const leaf = placeLeaf(idea, n)
      placedRef.current[i] = leaf

      // Arranca en escala 0: el brote lo anima useFrame.
      applyLeaf(mesh, flex, dummy, leaf, i, 0, tema)
      sproutRef.current.set(i, clockRef.current)
    }

    mesh.count = Math.min(ideas.length, MAX_LEAVES)
    mesh.instanceMatrix.needsUpdate = true
    flex.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    idsRef.current = nextIds
  }, [ideas, citizenGeometry, tema])

  // ---- Animación de brote + viento -----------------------------------
  useFrame((_, delta) => {
    clockRef.current += delta * 1000

    material.userData.wind.uWindTime.value += delta
    ambientMaterial.userData.wind.uWindTime.value += delta

    const mesh = citizenRef.current
    const sprouts = sproutRef.current
    if (!mesh || sprouts.size === 0) return

    const dummy = new THREE.Object3D()
    const flex = citizenGeometry.getAttribute('aFlex') as THREE.InstancedBufferAttribute
    let dirty = false

    for (const [index, startedAt] of sprouts) {
      const elapsed = clockRef.current - startedAt
      const leaf = placedRef.current[index]
      if (!leaf) {
        sprouts.delete(index)
        continue
      }

      if (elapsed >= SPROUT_MS) {
        applyLeaf(mesh, flex, dummy, leaf, index, 1, tema)
        sprouts.delete(index)
        dirty = true
        continue
      }

      const t = elapsed / SPROUT_MS
      applyLeaf(mesh, flex, dummy, leaf, index, sproutEase(t), tema)
      dirty = true
    }

    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      flex.needsUpdate = true
    }
  })

  // Sin dispose() manual: rompería el montaje doble de StrictMode.
  // Ver la nota en TreeStructure.tsx.

  return (
    <group>
      <instancedMesh
        ref={ambientRef}
        args={[ambientGeometry, ambientMaterial, MAX_AMBIENT]}
        frustumCulled={false}
        count={0}
      />
      <instancedMesh
        ref={citizenRef}
        args={[citizenGeometry, material, MAX_LEAVES]}
        frustumCulled={false}
        count={0}
      />
    </group>
  )
}

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

/** Brote con leve sobrepaso: crece, se pasa un poco y se asienta. */
function sproutEase(t: number): number {
  const c = 1.70158 * 1.28
  const p = t - 1
  return 1 + (c + 1) * p * p * p + c * p * p
}

/** Scratch del tinte por tema: applyLeaf corre miles de veces por brote. */
const TINTE = new THREE.Color()

function applyLeaf(
  mesh: THREE.InstancedMesh,
  flex: THREE.InstancedBufferAttribute,
  dummy: THREE.Object3D,
  leaf: PlacedLeaf,
  index: number,
  scaleFactor: number,
  tema: Tema,
) {
  dummy.position.copy(leaf.position)
  dummy.quaternion.copy(leaf.quaternion)
  dummy.scale.setScalar(leaf.scale * CITIZEN_SCALE * scaleFactor)
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
  mesh.setColorAt(index, segunFondo(TINTE, leaf.color, tema))
  flex.setX(index, leaf.slot.flex)
}

/**
 * Copia de la geometría de hoja con lugar para el atributo aFlex.
 *
 * La geometría base viene compartida por leafAssets, y un atributo por
 * instancia no se puede compartir: las dos capas de follaje tienen distinta
 * cantidad de hojas y distintos valores de flexión.
 */
function withFlexAttribute(capacity: number): THREE.BufferGeometry {
  const geometry = getLeafGeometry().clone()
  geometry.setAttribute(
    'aFlex',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  )
  return geometry
}

/**
 * Material de hoja con viento resuelto en el vertex shader.
 *
 * El viento por instancia calculado en JS obligaría a reescribir 1400
 * matrices por frame. Acá se desplaza el vértice en la GPU usando la
 * posición de la instancia como fase, así que el costo es cero.
 */
function makeLeafMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    alphaTest: 0.14,
    side: THREE.DoubleSide,
    depthWrite: true,
    toneMapped: false,
  })

  const wind = windUniforms(0.105)
  material.userData.wind = wind

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${WIND_GLSL}
        attribute float aFlex;
        varying float vShimmer;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>

        #ifdef USE_INSTANCING
          vec3 iPos = instanceMatrix[3].xyz;
        #else
          vec3 iPos = vec3(0.0);
        #endif

        /*
         * La hoja usa EXACTAMENTE el mismo viento que la rama que la
         * sostiene, evaluado en la posición de su instancia. Ese es todo el
         * truco: la ramita y su follaje se desplazan casi lo mismo, así que
         * el racimo viaja entero en vez de despegarse en cada ráfaga.
         *
         * El extra propio es chico y sólo agrega el aleteo de la hoja
         * suelta, que se mueve un poco más que la madera que la sostiene.
         */
        /* aFlex lo calcula treeGeometry con la misma fórmula que la
           corteza, en el punto exacto del que cuelga esta hoja. Medido
           sobre el árbol real va de 0.15 a 0.83 según la zona, así que
           una constante no servía: donde la madera es rígida las hojas
           se movían cinco veces de más y el racimo se despegaba. */
        vec3 windOffset = arboliaWind(iPos, aFlex);
        float leafFlex = aFlex;

        float rafaga = arboliaGust(uWindTime);
        float flutter = sin(uWindTime * 2.6 + iPos.x * 4.1 + iPos.z * 3.3);
        windOffset += vec3(flutter, flutter * 0.4, -flutter * 0.7)
                    * 0.016 * leafFlex * (0.4 + 0.6 * rafaga);

        /*
         * El desplazamiento sale del espacio de la instancia antes de
         * sumarse. Sin esto era un bug silencioso: la posición del vértice
         * está en
         * espacio LOCAL de la hoja y three aplica instanceMatrix DESPUÉS,
         * así que el viento se rotaba por la orientación de cada hoja —que
         * lleva un giro al azar sobre su normal— y cada una se iba para un
         * lado distinto. La copa no se movía con el viento: hormigueaba.
         *
         * Era también lo que obligaba a dejar la amplitud tan baja que no
         * se notara el desorden. La escala de instancia siempre es uniforme
         * (setScalar en los dos lugares donde se arma la matriz), así que
         * dividir por su cuadrado da la inversa exacta.
         */
        mat3 im = mat3(instanceMatrix);
        vec3 s2 = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
        transformed += (windOffset * im) / s2;

        /* El brillo viaja con la MISMA ráfaga que empuja las ramas: la
           ola de luz y el movimiento son el mismo evento, no dos. */
        vShimmer = 0.80 + 0.20 * rafaga
                 * (0.5 + 0.5 * sin(uWindTime * 1.2 + iPos.x * 2.0 + iPos.z * 1.6));
        `,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying float vShimmer;
        `,
      )
      .replace(
        '#include <dithering_fragment>',
        /* glsl */ `
        #include <dithering_fragment>
        gl_FragColor.rgb *= vShimmer;
        `,
      )
  }

  return material
}
