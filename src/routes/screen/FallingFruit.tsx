import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTreeModel } from './treeGeometry'
import {
  buildFallPath,
  CAER_MS,
  DESPRENDER_MS,
  HUNDIR_MS,
  SUELO,
} from './fallPath'
import { getGlowTexture } from './leafAssets'
import type { Idea } from '../../lib/types'

/**
 * La caída de una crítica.
 *
 * Una propuesta sube desde las raíces y brota como hoja. Una crítica hace
 * el camino inverso: se desprende de la copa —de la rama de SU área, no de
 * cualquiera—, cae, y se hunde en la tierra. Las raíces responden.
 *
 * No es un castigo ni un descarte, y por eso la caída es lenta y tiene
 * peso: un fruto maduro que cae al pie del árbol. La crítica se guarda,
 * cuenta para la meta y entra en el informe igual que cualquier otra idea.
 * Lo único distinto es dónde aparece.
 *
 * El componente vive aparte de Journey porque el recorrido de aquél
 * termina obligatoriamente en un slot de hoja: no se puede invertir.
 */

const ESTELA = 20
const SALPICADURA = 34

interface Props {
  idea: Idea | null
}

export default function FallingFruit({ idea }: Props) {
  const model = useMemo(() => getTreeModel(), [])
  const glow = useMemo(() => getGlowTexture(), [])

  const frutoRef = useRef<THREE.Sprite>(null)
  const estelaRef = useRef<THREE.Points>(null)
  const salpicaduraRef = useRef<THREE.Points>(null)
  const anilloRef = useRef<THREE.Mesh>(null)

  const transcurridoRef = useRef(0)
  const dirsRef = useRef<Float32Array>(new Float32Array(SALPICADURA * 3))

  /*
   * De dónde se desprende.
   *
   * Del extremo de la rama de su categoría: la crítica sale del área de la
   * ciudad de la que habla. Se reusa getLeafSlot con un índice derivado del
   * id para que caiga siempre del mismo punto —si la misma crítica se
   * reprodujera dos veces, saldría del mismo lugar— y para que dos críticas
   * seguidas de la misma área no salgan calcadas.
   */
  const caida = useMemo(() => {
    if (!idea) return null
    const p = buildFallPath(model, idea.category, idea.id)
    return { curva: p.curva, color: new THREE.Color(p.color) }
  }, [idea, model])

  const estelaGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ESTELA * 3), 3))
    g.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(ESTELA), 1))
    return g
  }, [])

  const salpicaduraGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(SALPICADURA * 3), 3),
    )
    return g
  }, [])

  // Reinicio al empezar una caída nueva.
  useEffect(() => {
    transcurridoRef.current = 0
    if (!caida) return

    // La salpicadura se abre hacia afuera y hacia abajo: entra en la tierra,
    // no rebota hacia arriba.
    const dirs = dirsRef.current
    for (let i = 0; i < SALPICADURA; i++) {
      const a = (i / SALPICADURA) * Math.PI * 2 + (i % 3) * 0.4
      const r = 0.55 + (i % 5) * 0.16
      dirs[i * 3] = Math.cos(a) * r
      dirs[i * 3 + 1] = -0.12 - (i % 4) * 0.05
      dirs[i * 3 + 2] = Math.sin(a) * r
    }

    const pos = estelaGeo.getAttribute('position') as THREE.BufferAttribute
    const inicio = caida.curva.getPoint(0)
    for (let i = 0; i < ESTELA; i++) pos.setXYZ(i, inicio.x, inicio.y, inicio.z)
    pos.needsUpdate = true
  }, [caida, estelaGeo])

  useFrame((_, delta) => {
    const fruto = frutoRef.current
    const anillo = anilloRef.current
    if (!fruto || !anillo) return

    if (!caida) {
      fruto.visible = false
      anillo.visible = false
      if (estelaRef.current) estelaRef.current.visible = false
      if (salpicaduraRef.current) salpicaduraRef.current.visible = false
      return
    }

    transcurridoRef.current += delta * 1000
    const t = transcurridoRef.current

    fruto.visible = true
    fruto.material.color.copy(caida.color)

    // ---- 1. Se desprende ------------------------------------------------
    // Madura en la rama y tiembla antes de soltarse. Sin esto la caída
    // arranca de la nada y no se entiende de dónde salió.
    if (t < DESPRENDER_MS) {
      const p = t / DESPRENDER_MS
      const punto = caida.curva.getPoint(0)
      const tiembla = p > 0.6 ? Math.sin(t * 0.05) * 0.012 * (p - 0.6) * 2.5 : 0

      fruto.position.set(punto.x + tiembla, punto.y, punto.z)
      const escala = 0.16 * Math.min(1, p * 2.4)
      fruto.scale.setScalar(escala)
      ;(fruto.material as THREE.SpriteMaterial).opacity = Math.min(1, p * 2.4)

      if (estelaRef.current) estelaRef.current.visible = false
      anillo.visible = false
      return
    }

    // ---- 2. Cae ---------------------------------------------------------
    if (t < DESPRENDER_MS + CAER_MS) {
      const p = (t - DESPRENDER_MS) / CAER_MS
      // Aceleración: cae con peso, no flota hacia abajo.
      const avance = p * p * (3 - 2 * p) * 0.35 + p * p * 0.65
      const punto = caida.curva.getPoint(Math.min(1, avance))

      fruto.position.copy(punto)
      fruto.scale.setScalar(0.16)
      ;(fruto.material as THREE.SpriteMaterial).opacity = 1

      // Estela: cada punto persigue al anterior, así se estira al acelerar.
      const estela = estelaRef.current
      if (estela) {
        estela.visible = true
        const pos = estela.geometry.getAttribute('position') as THREE.BufferAttribute
        const size = estela.geometry.getAttribute('size') as THREE.BufferAttribute
        for (let i = ESTELA - 1; i > 0; i--) {
          pos.setXYZ(i, pos.getX(i - 1), pos.getY(i - 1), pos.getZ(i - 1))
          size.setX(i, (1 - i / ESTELA) * 0.09)
        }
        pos.setXYZ(0, punto.x, punto.y, punto.z)
        size.setX(0, 0.1)
        pos.needsUpdate = true
        size.needsUpdate = true
      }

      anillo.visible = false
      return
    }

    // ---- 3. Se hunde y las raíces responden -----------------------------
    const p = Math.min(1, (t - DESPRENDER_MS - CAER_MS) / HUNDIR_MS)

    // El fruto entra en la tierra: baja un poco más y se apaga.
    fruto.position.set(SUELO.x, SUELO.y - p * 0.22, SUELO.z)
    fruto.scale.setScalar(0.16 * (1 - p))
    ;(fruto.material as THREE.SpriteMaterial).opacity = 1 - p

    // Anillo de energía que se abre en el suelo, hacia las raíces.
    anillo.visible = true
    const abre = 1 - (1 - p) * (1 - p)
    anillo.scale.setScalar(0.25 + abre * 2.4)
    const matAnillo = anillo.material as THREE.MeshBasicMaterial
    matAnillo.color.copy(caida.color)
    matAnillo.opacity = 0.5 * (1 - p)

    // Salpicadura: la energía se reparte por la base.
    const salpicadura = salpicaduraRef.current
    if (salpicadura) {
      salpicadura.visible = true
      const pos = salpicadura.geometry.getAttribute('position') as THREE.BufferAttribute
      const dirs = dirsRef.current
      for (let i = 0; i < SALPICADURA; i++) {
        pos.setXYZ(
          i,
          SUELO.x + dirs[i * 3] * abre,
          SUELO.y + dirs[i * 3 + 1] * abre,
          SUELO.z + dirs[i * 3 + 2] * abre,
        )
      }
      pos.needsUpdate = true
      ;(salpicadura.material as THREE.PointsMaterial).opacity = 0.85 * (1 - p)
      ;(salpicadura.material as THREE.PointsMaterial).color.copy(caida.color)
    }

    const estela = estelaRef.current
    if (estela) (estela.material as THREE.PointsMaterial).opacity = 0.7 * (1 - p)
  })

  return (
    <group>
      {/*
        frustumCulled en false en todo el grupo.

        Estas geometrías cambian de posición en cada cuadro y nunca se les
        recalcula la esfera envolvente, así que Three.js las juzga por un
        volumen que quedó en el origen con radio cero y las descarta antes
        de dibujarlas. Journey hace lo mismo por la misma razón: sin esto
        el fruto se ve pero la estela y la salpicadura no aparecen nunca.
      */}

      {/* El fruto */}
      <sprite ref={frutoRef} visible={false} frustumCulled={false}>
        <spriteMaterial
          map={glow}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          // Sin esto el mapeo de tonos apaga el resplandor y el fruto se
          // pierde contra la copa. Journey usa el mismo ajuste.
          toneMapped={false}
          opacity={0}
        />
      </sprite>

      {/* Estela de la caída */}
      <points ref={estelaRef} geometry={estelaGeo} visible={false} frustumCulled={false}>
        <pointsMaterial
          map={glow}
          size={0.07}
          sizeAttenuation
          transparent
          opacity={0.7}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>

      {/* Onda en la tierra */}
      <mesh
        ref={anilloRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        visible={false}
        frustumCulled={false}
      >
        <ringGeometry args={[0.42, 0.5, 48]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Energía repartiéndose por la base */}
      <points ref={salpicaduraRef} geometry={salpicaduraGeo} visible={false} frustumCulled={false}>
        <pointsMaterial
          map={glow}
          size={0.11}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  )
}
