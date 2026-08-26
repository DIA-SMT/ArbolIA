import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getLeafGeometry, getLeafTexture } from './leafAssets'
import { getTreeModel } from './treeGeometry'
import { leafQuaternion, placeAll, placeLeaf, type PlacedLeaf } from './leafPlacement'
import { WIND_GLSL, windUniforms } from './windShader'
import type { GrowthProfile, Idea } from '../../lib/types'

const MAX_LEAVES = 1400
const MAX_AMBIENT = 4200
/** Duración del brote de una hoja recién integrada. */
const SPROUT_MS = 1100
/** Las hojas ciudadanas van mas grandes que el follaje base: tienen que
 *  distinguirse dentro de la masa, no perderse en ella. */
const CITIZEN_SCALE = 1.34

interface Props {
  ideas: Idea[]
  growth: GrowthProfile
}

/**
 * Follaje del árbol en dos capas instanciadas:
 *
 *  1. Ambiente — hojas tenues que existen desde el minuto cero. Sin esto,
 *     el primer día a las 9 de la mañana el árbol se vería pelado, y un
 *     árbol pelado no genera "¿qué es eso?", genera lástima.
 *  2. Ciudadanas — una por idea recibida, con el color de su categoría y
 *     un brillo muy por encima del ambiente. Son las que se ven.
 */
export default function Leaves({ ideas, growth }: Props) {
  const citizenRef = useRef<THREE.InstancedMesh>(null)
  const ambientRef = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => getLeafGeometry(), [])
  const model = useMemo(() => getTreeModel(), [])

  // Estado de colocación entre renders.
  const placedRef = useRef<PlacedLeaf[]>([])
  const idsRef = useRef<string[]>([])
  const sproutRef = useRef<Map<number, number>>(new Map())
  const clockRef = useRef(0)

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
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [model])

  // La densidad del follaje base sube con la etapa de crecimiento.
  useLayoutEffect(() => {
    const mesh = ambientRef.current
    if (!mesh) return
    mesh.count = Math.min(
      MAX_AMBIENT,
      Math.round(MAX_AMBIENT * Math.min(1, growth.foliageDensity)),
    )
  }, [growth.foliageDensity])

  // ---- Hojas ciudadanas ---------------------------------------------
  useLayoutEffect(() => {
    const mesh = citizenRef.current
    if (!mesh) return

    const previous = idsRef.current
    const nextIds = ideas.map((i) => i.id)

    // ¿Es un append puro? (el caso normal: llegó una idea nueva)
    const isAppend =
      nextIds.length >= previous.length &&
      previous.every((id, index) => nextIds[index] === id)

    const dummy = new THREE.Object3D()

    if (!isAppend) {
      // Cambió el conjunto (moderación retiró una hoja, o hubo reinicio):
      // recalculamos toda la copa. Es raro y cuesta pocos milisegundos.
      const { leaves } = placeAll(ideas)
      placedRef.current = leaves
      sproutRef.current.clear()

      leaves.forEach((leaf, i) => {
        if (i >= MAX_LEAVES) return
        applyLeaf(mesh, dummy, leaf, i, 1)
      })
      mesh.count = Math.min(leaves.length, MAX_LEAVES)
      mesh.instanceMatrix.needsUpdate = true
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
      applyLeaf(mesh, dummy, leaf, i, 0)
      sproutRef.current.set(i, clockRef.current)
    }

    mesh.count = Math.min(ideas.length, MAX_LEAVES)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    idsRef.current = nextIds
  }, [ideas])

  // ---- Animación de brote + viento -----------------------------------
  useFrame((_, delta) => {
    clockRef.current += delta * 1000

    material.userData.wind.uWindTime.value += delta
    ambientMaterial.userData.wind.uWindTime.value += delta

    const mesh = citizenRef.current
    const sprouts = sproutRef.current
    if (!mesh || sprouts.size === 0) return

    const dummy = new THREE.Object3D()
    let dirty = false

    for (const [index, startedAt] of sprouts) {
      const elapsed = clockRef.current - startedAt
      const leaf = placedRef.current[index]
      if (!leaf) {
        sprouts.delete(index)
        continue
      }

      if (elapsed >= SPROUT_MS) {
        applyLeaf(mesh, dummy, leaf, index, 1)
        sprouts.delete(index)
        dirty = true
        continue
      }

      const t = elapsed / SPROUT_MS
      applyLeaf(mesh, dummy, leaf, index, sproutEase(t))
      dirty = true
    }

    if (dirty) mesh.instanceMatrix.needsUpdate = true
  })

  // Sin dispose() manual: rompería el montaje doble de StrictMode.
  // Ver la nota en TreeStructure.tsx.

  return (
    <group>
      <instancedMesh
        ref={ambientRef}
        args={[geometry, ambientMaterial, MAX_AMBIENT]}
        frustumCulled={false}
        count={0}
      />
      <instancedMesh
        ref={citizenRef}
        args={[geometry, material, MAX_LEAVES]}
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

function applyLeaf(
  mesh: THREE.InstancedMesh,
  dummy: THREE.Object3D,
  leaf: PlacedLeaf,
  index: number,
  scaleFactor: number,
) {
  dummy.position.copy(leaf.position)
  dummy.quaternion.copy(leaf.quaternion)
  dummy.scale.setScalar(leaf.scale * CITIZEN_SCALE * scaleFactor)
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
  mesh.setColorAt(index, leaf.color)
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

  const wind = windUniforms(0.03)
  material.userData.wind = wind

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        ${WIND_GLSL}
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
        float leafFlex = smoothstep(0.0, 1.6, iPos.y);
        vec3  windOffset = arboliaWind(iPos, leafFlex);

        float flutter = sin(uWindTime * 2.6 + iPos.x * 4.1 + iPos.z * 3.3);
        windOffset += vec3(flutter, flutter * 0.4, -flutter * 0.7) * 0.008 * leafFlex;

        transformed += windOffset;

        vShimmer = 0.86 + 0.14 * sin(uWindTime * 1.2 + iPos.x * 2.0 + iPos.z * 1.6);
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
