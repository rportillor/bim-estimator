/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  TRANSFORM CONTROLS — Gizmo for move/rotate/scale in 3D viewport
 *  Wraps Three.js TransformControls with BIM-specific snapping and constraints.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
// @ts-ignore
import { TransformControls } from 'three/examples/jsm/controls/TransformControls';
// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface TransformResult {
  elementId: string;
  position: { x: number; y: number; z: number };
  rotation: number; // radians around Y axis
  scale: { x: number; y: number; z: number };
}

export class BIMTransformControls {
  private controls: TransformControls;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private orbitControls: OrbitControls;
  private selectedMesh: THREE.Object3D | null = null;
  private onChange: ((result: TransformResult) => void) | null = null;
  private _mode: TransformMode = 'translate';

  // Snapping
  private snapTranslation = 0.05; // 50mm grid snap
  private snapRotation = Math.PI / 12; // 15° snap
  private snapScale = 0.1;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    domElement: HTMLElement,
    orbitControls: OrbitControls,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.orbitControls = orbitControls;

    this.controls = new TransformControls(camera, domElement);
    this.controls.setSize(0.75);
    this.controls.setSpace('world');
    this.scene.add(this.controls);

    // Enable snapping by default
    this.controls.setTranslationSnap(this.snapTranslation);
    this.controls.setRotationSnap(this.snapRotation);
    this.controls.setScaleSnap(this.snapScale);

    // Disable orbit when dragging transform gizmo
    this.controls.addEventListener('dragging-changed', (event: any) => {
      this.orbitControls.enabled = !event.value;
    });

    // Emit changes on transform
    this.controls.addEventListener('objectChange', () => {
      if (!this.selectedMesh || !this.onChange) return;

      const pos = this.selectedMesh.position;
      const rot = this.selectedMesh.rotation;
      const scl = this.selectedMesh.scale;

      // Convert Three.js Y-up back to BIM Z-up
      this.onChange({
        elementId: this.selectedMesh.userData?.element?.globalId
          || this.selectedMesh.userData?.element?.ifcGuid
          || this.selectedMesh.userData?.element?.id
          || '',
        position: { x: pos.x, y: pos.z, z: pos.y }, // Y↔Z swap
        rotation: rot.y,
        scale: { x: scl.x, y: scl.z, z: scl.y },
      });
    });
  }

  /** Attach gizmo to a mesh */
  attach(mesh: THREE.Object3D): void {
    this.selectedMesh = mesh;
    this.controls.attach(mesh);

    // Highlight selected element
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (!child.userData._origEmissive) {
          child.userData._origEmissive = mat.emissive?.getHex() || 0;
        }
        mat.emissive = new THREE.Color(0x333300);
      }
    });
  }

  /** Detach gizmo from current mesh */
  detach(): void {
    if (this.selectedMesh) {
      // Remove highlight
      this.selectedMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.emissive = new THREE.Color(child.userData._origEmissive || 0);
        }
      });
    }
    this.selectedMesh = null;
    this.controls.detach();
  }

  /** Set transform mode */
  setMode(mode: TransformMode): void {
    this._mode = mode;
    this.controls.setMode(mode);
  }

  getMode(): TransformMode {
    return this._mode;
  }

  /** Toggle snapping */
  setSnapping(enabled: boolean): void {
    if (enabled) {
      this.controls.setTranslationSnap(this.snapTranslation);
      this.controls.setRotationSnap(this.snapRotation);
      this.controls.setScaleSnap(this.snapScale);
    } else {
      this.controls.setTranslationSnap(null);
      this.controls.setRotationSnap(null);
      this.controls.setScaleSnap(null);
    }
  }

  /** Set snap grid size */
  setSnapSize(translation: number, rotation?: number): void {
    this.snapTranslation = translation;
    if (rotation) this.snapRotation = rotation;
    this.controls.setTranslationSnap(this.snapTranslation);
    this.controls.setRotationSnap(this.snapRotation);
  }

  /** Register change callback */
  onTransformChange(callback: (result: TransformResult) => void): void {
    this.onChange = callback;
  }

  /** Check if gizmo is active (dragging) */
  isDragging(): boolean {
    return this.controls.dragging;
  }

  /** Dispose of controls */
  dispose(): void {
    this.detach();
    this.scene.remove(this.controls);
    this.controls.dispose();
  }
}
