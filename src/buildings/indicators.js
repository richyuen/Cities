import * as THREE from 'three';

// A small pooled billboard sprite hovering over any building simulation flags as missing road, power, or water
// (see simulation/model.js `unserved`). One shared texture/material for every sprite - they're all identical,
// so there's nothing to gain from per-instance materials (unlike buildings/index.js's spawnConstructionFlash,
// which needs a unique material per flash for its own fade tween).
const ICON_PX = 64;

function buildWarningTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = ICON_PX;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(32, 5);
  g.lineTo(61, 57);
  g.lineTo(3, 57);
  g.closePath();
  g.fillStyle = '#ffcc33';
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#3a2400';
  g.stroke();
  g.fillStyle = '#3a2400';
  g.fillRect(29, 21, 6, 19);
  g.beginPath();
  g.arc(32, 47.5, 3.4, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class UnservedIndicators {
  constructor() {
    this.texture = buildWarningTexture();
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.group = new THREE.Group();
    this.group.name = 'buildings-unserved-indicators';
    this.pool = [];
    this.active = new Map(); // building id -> sprite
  }

  _acquire() {
    const sprite = this.pool.pop() || new THREE.Sprite(this.material);
    if (!sprite.parent) this.group.add(sprite);
    sprite.scale.set(3, 3, 1);
    sprite.visible = true;
    return sprite;
  }

  _release(sprite) {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  /** ids: current unserved building ids (from simulation.getUnservedBuildings()); batcher: buildings' BuildingBatcher. */
  sync(ids, batcher) {
    const wanted = new Set(ids);
    for (const [id, sprite] of this.active) {
      if (!wanted.has(id)) { this._release(sprite); this.active.delete(id); }
    }
    for (const id of ids) {
      const info = batcher.get(id);
      if (!info) continue; // not yet batched (or already removed) - picked up on the next sync
      let sprite = this.active.get(id);
      if (!sprite) { sprite = this._acquire(); this.active.set(id, sprite); }
      sprite.position.set(info.cx, info.baseY + info.height + 2, info.cz);
    }
  }

  dispose() {
    for (const sprite of this.group.children.slice()) this.group.remove(sprite);
    this.pool.length = 0;
    this.active.clear();
    this.material.dispose();
    this.texture.dispose();
  }
}
