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

/** Cuánto dura el resplandor de las raíces tras una crítica, en segundos. */
const PULSO_SEG = 2.8

interface Props {
  growth: GrowthProfile
  /** Categoría que está recibiendo una idea ahora mismo: su rama se enciende. */
  highlightSlug: string | null
  /**
   * Sube de a uno cada vez que una crítica toca la tierra.
   *
   * El efecto se dispara acá adentro y no desde afuera por una razón
   * concreta: este useFrame reescribe uIntensity y uReveal de las raíces en
   * CADA cuadro. Cualquier componente que intentara encenderlas desde fuera
   * vería su valor borrado al cuadro siguiente.
   */
  pulsoRaices: number
}

/**
 * Raíces (comunidad) → tronco (ciudad) → ramas (áreas).
 *
 * Cada categoría ramifica en unas 25 ramitas, así que son ~200 tubos en
 * total. Se fusionan en 10 mallas (tronco + raíces + 8 áreas) para no
 * gastar doscientas llamadas de dibujo en una PC de stand.
 */
export default function TreeStructure({ growth, highlightSlug, pulsoRaices }: Props) {
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
            // El voladizo va aparte y encadenado por axila, no por nivel:
            // es lo que mantiene pegada la hija a la madre bajo el viento.
            spanStart: twig.spanStart,
            spanEnd: twig.spanEnd,
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
        /*
         * La corteza del tronco.
         *
         * Era #12212e, que sobre el fondo #050a12 de la instalación se lee
         * negro: el tronco quedaba como una silueta recortada, sin volumen,
         * y era lo primero que saltaba mirando el render a resolución de LED.
         * El shader además lo oscurece por grosor —a propósito, las ramitas
         * finas van más claras— así que el tronco es la parte que más
         * necesita el valor de partida alto.
         */
        barkColor: '#26485f',
        speed: 0.1,
        pulseCount: 1.7,
        direction: 1,
        rimPower: 3.6,
        // El tronco cede muy poco: es la parte gruesa del árbol.
        windStrength: 0,
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
          /*
           * Se aclaró de #111f2b, que sobre el fondo #050a12 era casi el
           * fondo mismo.
           *
           * Antes no se notaba porque la copa arrancaba con miles de hojas
           * encima: las ramas eran una sombra debajo del follaje y estaba
           * bien que lo fueran. Ahora el árbol arranca pelado y el esqueleto
           * es TODO lo que hay en pantalla el primer día, así que tiene que
           * leerse solo. El shader oscurece por grosor, así que las ramitas
           * finas siguen siendo las más claras y la copa vacía se lee como
           * una trama y no como una masa.
           */
          barkColor: '#1e3a4d',
          speed: 0.15,
          pulseCount: 1.2,
          direction: 1,
          rimPower: 3.4,
          // Las ramas son las que se mecen de verdad.
          windStrength: 0.1,
        }),
      ),
    [model],
  )

  const allMaterials = useRef<THREE.ShaderMaterial[]>([])
  allMaterials.current = [trunkMaterial, rootMaterial, ...branchMaterials]

  /*
   * Estado del pulso de las raíces.
   *
   * En segundos y no en cuadros: los demás lerps de la escena usan factor
   * por cuadro, así que su duración real cambia con el framerate. Este
   * efecto tiene que durar lo mismo en la máquina de desarrollo y en la PC
   * del stand a 30 fps, porque es lo que la gente va a estar mirando.
   */
  const pulso = useRef({ visto: 0, restante: 0 })

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
    // Una crítica acaba de tocar la tierra.
    if (pulsoRaices !== pulso.current.visto) {
      pulso.current.visto = pulsoRaices
      pulso.current.restante = PULSO_SEG
    }
    if (pulso.current.restante > 0) {
      pulso.current.restante = Math.max(0, pulso.current.restante - delta)
    }
    // Sube de golpe y se apaga despacio: el reclamo llega y queda resonando.
    const p = pulso.current.restante / PULSO_SEG
    const brilloExtra = p * p * 2.6

    for (const mat of allMaterials.current) {
      mat.uniforms.uTime.value += delta
      mat.uniforms.uWindTime.value += delta
    }

    trunkMaterial.uniforms.uIntensity.value = growth.glowIntensity * (1 + brilloExtra * 0.25)
    rootMaterial.uniforms.uIntensity.value = growth.glowIntensity * 0.85 + brilloExtra

    // Mientras dura el pulso la energía circula más rápido hacia el tronco:
    // se ve que las raíces le están mandando algo al árbol.
    rootMaterial.uniforms.uSpeed.value = 0.09 + brilloExtra * 0.22

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
