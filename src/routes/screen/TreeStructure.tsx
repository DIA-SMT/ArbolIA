import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createEnergyMaterial } from './energyMaterial'
import {
  addTube,
  branchRadiusFor,
  createAccumulator,
  createTaperedTube,
  finalize,
  rootRadius,
  trunkRadius,
} from './tubeBuilder'
import { getTreeModel } from './treeGeometry'
import type { GrowthProfile } from '../../lib/types'

interface Props {
  growth: GrowthProfile
  /** Categoría que está recibiendo una idea ahora mismo: su rama se enciende. */
  highlightSlug: string | null
}

/**
 * Raíces (comunidad) → tronco (ciudad) → ramas (áreas).
 *
 * Cada categoría ramifica en unas 25 ramitas, así que son ~200 tubos en
 * total. Se fusionan en 10 mallas (tronco + raíces + 8 áreas) para no
 * gastar doscientas llamadas de dibujo en una PC de stand.
 */
export default function TreeStructure({ growth, highlightSlug }: Props) {
  const model = useMemo(() => getTreeModel(), [])

  const trunkGeo = useMemo(
    () => createTaperedTube(model.trunk, trunkRadius, 40, 14),
    [model],
  )

  const rootsGeo = useMemo(() => {
    const acc = createAccumulator()
    model.roots.forEach((root) => {
      // uvStart/uvEnd encadenan madre y secundarias en un solo recorrido,
      // así el frente de crecimiento avanza continuo de una a otra.
      addTube(acc, root.curve, (t) => rootRadius(t) * (root.level === 1 ? 1 : 0.42), {
        segments: root.level === 1 ? 26 : 14,
        radialSegments: root.level === 1 ? 8 : 6,
        thickness: root.level === 1 ? 0.95 : 0.55,
        uvStart: root.uvStart,
        uvEnd: root.uvEnd,
      })
    })
    return finalize(acc)
  }, [model])

  const branchGeos = useMemo(
    () =>
      model.branches.map((branch) => {
        const acc = createAccumulator()

        branch.twigs.forEach((twig) => {
          // El grosor relativo baja con el nivel: el shader lo usa para que
          // las ramitas finas brillen más que la madera gruesa.
          const thickness = 1 - (twig.level - 1) / 4

          addTube(acc, twig.curve, branchRadiusFor(twig.level, twig.radius), {
            segments: twig.segments,
            radialSegments: Math.max(4, 8 - twig.level),
            thickness,
            // Encadena los niveles: el frente de crecimiento avanza del
            // tronco a la punta pasando de una rama a su hija sin saltos.
            uvStart: twig.uvStart,
            uvEnd: twig.uvEnd,
          })
        })

        return finalize(acc)
      }),
    [model],
  )

  const trunkMaterial = useMemo(
    () =>
      createEnergyMaterial({
        energyColor: '#3cb4f0',
        barkColor: '#12212e',
        speed: 0.1,
        pulseCount: 1.7,
        direction: 1,
        rimPower: 3.6,
        // El tronco cede muy poco: es la parte gruesa del árbol.
        windStrength: 0.012,
      }),
    [],
  )

  const rootMaterial = useMemo(
    () =>
      createEnergyMaterial({
        energyColor: '#25d366',
        barkColor: '#0e1a24',
        speed: 0.09,
        pulseCount: 1.4,
        // Las raíces empujan energía HACIA el tronco: la comunidad alimenta.
        direction: -1,
        rimPower: 3.9,
        // Las raices se revelan al crecer: el corte deja el tubo abierto.
        doubleSided: true,
        reveal: 0.4,
        // Bajo tierra no hay viento.
        windStrength: 0,
      }),
    [],
  )

  const branchMaterials = useMemo(
    () =>
      model.branches.map((branch) =>
        createEnergyMaterial({
          energyColor: branch.color,
          barkColor: '#111f2b',
          speed: 0.15,
          pulseCount: 1.2,
          direction: 1,
          rimPower: 3.4,
          // Las ramas son las que se mecen de verdad.
          windStrength: 0.038,
        }),
      ),
    [model],
  )

  const allMaterials = useRef<THREE.ShaderMaterial[]>([])
  allMaterials.current = [trunkMaterial, rootMaterial, ...branchMaterials]

  /*
   * Sin dispose() manual, a propósito.
   *
   * Geometrías y materiales viven en useMemo, así que sobreviven a un
   * remontaje. Un efecto de limpieza que los destruya deja objetos ya
   * liberados en el segundo montaje y el árbol desaparece sin ningún error.
   * Cuando el <Canvas> se desmonta de verdad, R3F descarta el renderer y
   * libera todo lo de la GPU igual.
   */

  useFrame((_, delta) => {
    for (const mat of allMaterials.current) {
      mat.uniforms.uTime.value += delta
      mat.uniforms.uWindTime.value += delta
    }

    trunkMaterial.uniforms.uIntensity.value = growth.glowIntensity
    rootMaterial.uniforms.uIntensity.value = growth.glowIntensity * 0.85

    // Las raices se extienden con la participacion. Interpolado y lento:
    // tienen que verse avanzar, no aparecer de un salto al cruzar un umbral.
    rootMaterial.uniforms.uReveal.value = THREE.MathUtils.lerp(
      rootMaterial.uniforms.uReveal.value,
      growth.rootReach,
      0.015,
    )

    // La rama de la categoría entrante se enciende mientras dura el viaje.
    model.branches.forEach((branch, i) => {
      const mat = branchMaterials[i]
      const active = highlightSlug === branch.slug
      const target = active ? growth.glowIntensity * 2.4 : growth.glowIntensity

      mat.uniforms.uIntensity.value = THREE.MathUtils.lerp(
        mat.uniforms.uIntensity.value,
        target,
        active ? 0.2 : 0.05,
      )
      mat.uniforms.uSpeed.value = active ? 0.46 : 0.15
    })
  })

  return (
    <group>
      {/* Raíces: la comunidad */}
      <mesh geometry={rootsGeo} material={rootMaterial} />

      {/* Tronco: la ciudad */}
      <mesh geometry={trunkGeo} material={trunkMaterial} />

      {/* Ramas: las áreas */}
      {branchGeos.map((geo, i) => (
        <mesh key={model.branches[i].slug} geometry={geo} material={branchMaterials[i]} />
      ))}
    </group>
  )
}
