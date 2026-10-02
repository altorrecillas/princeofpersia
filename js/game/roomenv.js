// Escena sencilla para generar el mapa de entorno (reflejos cálidos de antorchas en metal y mármol).
import * as THREE from 'three';

export class RoomEnvironment extends THREE.Scene {
  constructor() {
    super();
    const box = new THREE.BoxGeometry();
    box.deleteAttribute('uv');
    const room = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ side: THREE.BackSide, color: 0x1a1612, roughness: 1 }));
    room.scale.set(20, 10, 20);
    room.position.y = 4;
    this.add(room);
    const emit = (color, intensity, pos, scale) => {
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
      m.position.set(...pos); m.scale.set(...scale);
      this.add(m);
    };
    emit(0xff9a50, 6, [-6, 3, -8], [1.2, 1.6, 0.2]);
    emit(0xff8a40, 5, [7, 2.5, -7], [1, 1.4, 0.2]);
    emit(0xffb070, 4, [0, 3, 9], [3, 1.2, 0.2]);
    emit(0x8aa0ff, 2.2, [0, 8.9, 0], [8, 0.2, 8]);
    emit(0xffd0a0, 3, [-9.5, 4, 2], [0.2, 2, 3]);
  }
}
