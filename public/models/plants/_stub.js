import * as THREE from 'three';
// Stub: proves the harness. Builders replace with real factories.
export function createPlant({ height = 0.8 } = {}) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, height, 6), new THREE.MeshStandardMaterial({ color: 0x4a6b2a }));
  stem.position.y = height / 2; g.add(stem);
  return g;
}
