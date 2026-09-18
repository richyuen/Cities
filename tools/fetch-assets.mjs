#!/usr/bin/env node
// Downloads a curated set of CC0 assets from Poly Haven (1K) into public/assets and writes manifest.json.
// Every entry records the source URL and license. Failures are skipped (modules fall back to procedural).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'public/assets';
const MANIFEST = path.join(ROOT, 'manifest.json');
const PH = 'https://dl.polyhaven.org/file/ph-assets';

const HDRIS = {
  sky_day: 'kloofendal_48d_partly_cloudy_puresky',
  sky_noon: 'kloofendal_43d_clear_puresky',
  sky_sunset: 'belfast_sunset_puresky',
  sky_dawn: 'kiara_1_dawn',
  sky_overcast: 'kloppenheim_06_puresky',
  sky_night: 'moonless_golf',
};
const TEXTURES = {
  asphalt: 'asphalt_02',
  concrete: 'concrete_floor_worn_001',
  pavers: 'concrete_pavers_02',
  grass: 'aerial_grass_rock',
  rock: 'rock_06',
  sand: 'coast_sand_01',
  soil: 'brown_mud_leaves_01',
  plastic: 'plastic_grey',
  water_normal: 'water_normal',
};
const TEX_SLOTS = { map: 'diff', normalMap: 'nor_gl', roughnessMap: 'rough', aoMap: 'ao' };

async function dl(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return true;
  const r = await fetch(url);
  if (!r.ok) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return true;
}

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
for (const [name, id] of Object.entries(HDRIS)) {
  const url = `${PH}/HDRIs/hdr/1k/${id}_1k.hdr`;
  const dest = `${ROOT}/hdri/${id}_1k.hdr`;
  const ok = await dl(url, dest).catch(() => false);
  console.log(`${ok ? 'ok  ' : 'FAIL'} hdri ${name} <- ${url}`);
  if (ok) manifest[name] = { file: `/assets/hdri/${id}_1k.hdr`, source: `https://polyhaven.com/a/${id}`, license: 'CC0' };
}
for (const [name, id] of Object.entries(TEXTURES)) {
  const files = {};
  for (const [slot, suffix] of Object.entries(TEX_SLOTS)) {
    const url = `${PH}/Textures/jpg/1k/${id}/${id}_${suffix}_1k.jpg`;
    const dest = `${ROOT}/tex/${id}/${id}_${suffix}_1k.jpg`;
    const ok = await dl(url, dest).catch(() => false);
    if (ok) files[slot] = `/assets/tex/${id}/${id}_${suffix}_1k.jpg`;
  }
  console.log(`${files.map ? 'ok  ' : 'FAIL'} tex ${name} (${Object.keys(files).join(',')})`);
  if (files.map) manifest[name] = { files, source: `https://polyhaven.com/a/${id}`, license: 'CC0' };
}
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log('wrote', MANIFEST, Object.keys(manifest).length, 'entries');
