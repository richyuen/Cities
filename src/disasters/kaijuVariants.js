// Kaiju variants: the same skeleton, gait and proportions (kaijuGait.js), a different creature on it. A variant is
// data for the rig only (kaiju.js): the simulation never reads it, so every variant walks, stomps, sweeps and
// breathes exactly alike. The order of this table is the order they rise in (disasters/index.js cycles through it).
//
// `build(part)` lists the static bricks: part(frame, colour, x, y, z, sx, sy, sz, rz = 0), a unit box on the 'body',
// 'head' or 'jaw' frame (jaw coordinates are relative to its hinge). Local space: +X forward, +Y up, +Z right.
// Colours are palette names (core/materials.js). `legs`: thigh, shin, foot and three claws. `tail`: the colour of a
// segment, of the last one and of the plate each carries, and how big and how thick plate i is. `eye`: its colour,
// the colour it glows (`glow`, else the same) and its size.

const SIDES = [-1, 1];
// along the back, head to hips: where the spine is and how big a plate it carries there
const SPINE = [[2.6, 49.6, 3], [-1.2, 45.6, 4.4], [-3.4, 40.4, 5.6], [-5, 34.6, 6.2], [-6, 29, 5.4], [-7.4, 25, 4.2]];

/** Torso, leaning forward, and the two belly plates. */
function torso(part, c, belly) {
  part('body', c, -0.5, 24.5, 0, 10, 9, 12);
  part('body', c, -5, 22.5, 0, 6, 7, 7.5);
  part('body', c, 1, 32, 0, 11, 9, 11.5, -0.12);
  part('body', c, 3, 40, 0, 10, 9, 10.5, -0.2);
  part('body', c, 5.6, 46.4, 0, 5.5, 6, 5.5, -0.35);
  part('body', belly, 7, 33.2, 0, 1.2, 15, 7.5, -0.15);
  part('body', belly, 8.7, 41, 0, 1.2, 7, 6.5, -0.25);
}

/** Shoulder, upper arm, forearm, claw and a shoulder stud, both sides. */
function arms(part, arm, claw, stud) {
  for (const s of SIDES) {
    part('body', arm, 4.5, 42, s * 6, 4.2, 4.2, 3, -0.2);
    part('body', arm, 6.2, 38.3, s * 6.4, 2.6, 7, 2.6, 0.5);
    part('body', arm, 9.7, 35, s * 6.4, 5.6, 2.2, 2.2, -0.25);
    part('body', claw, 12.8, 34.1, s * 6.4, 1.6, 1.2, 2.6, -0.25);
    part('body', stud, 3, 45.1, s * 3, 1.8, 0.6, 1.8, -0.2);
  }
}

/** Skull and snout, brows and studs; a row of upper teeth unless `tooth` is null. */
function skull(part, c, brow, tooth) {
  part('head', c, 9, 50.5, 0, 8, 6, 7);
  part('head', c, 14.6, 50, 0, 5, 3.8, 5.4);
  for (const s of SIDES) {
    part('head', brow, 11.3, 53.2, s * 2.7, 2.8, 1, 2);
    part('head', c, 8, 53.8, s * 2.2, 1.7, 0.6, 1.7);
    part('head', c, 15.4, 52.2, s * 1.4, 1.2, 0.6, 1.2);
    if (tooth) for (const x of [13.2, 15.4]) part('head', tooth, x, 47.7, s * 2.1, 0.8, 1.1, 0.8);
  }
}

function jaw(part, c, tooth) {
  part('jaw', c, 4.4, -0.7, 0, 9.4, 1.6, 4.8);
  if (tooth) for (const s of SIDES) part('jaw', tooth, 7.4, 0.5, s * 1.9, 0.8, 0.9, 0.8);
}

export const KAIJU_VARIANTS = [
  {
    id: 'lizard', name: 'Gorgo the Lizard', emoji: '\u{1F996}',
    eye: { color: 'brightRed', glow: 'brightOrange', w: 1.7, h: 1.2 },
    legs: ['darkGreen', 'darkGreen', 'brightGreen', 'white', 'white', 'white'],
    tail: { seg: 'brightGreen', tip: 'darkGreen', plate: 'brightOrange', plateSize: (i) => 3.6 - i * 0.8, plateThick: () => 0.8 },
    build(part) {
      const G = 'brightGreen', D = 'darkGreen', O = 'brightOrange', W = 'white';
      torso(part, G, 'sandGreen');
      arms(part, D, W, G);
      // back plates: thin boxes stood on a corner, each with a stud
      for (const [x, y, sz] of SPINE) {
        part('body', O, x, y, 0, sz, sz, 0.9, Math.PI / 4);
        part('body', O, x - sz * 0.42, y + sz * 0.42, 0, 1, 1, 1.5, Math.PI / 4);
      }
      skull(part, G, D, W);
      part('head', O, 6.6, 54.4, 0, 2.6, 2.6, 0.9, Math.PI / 4);
      jaw(part, D, W);
    },
  },
  {
    id: 'brute', name: 'Ragnar the Horned Brute', emoji: '\u{1F479}',
    eye: { color: 'brightYellow', w: 1.9, h: 1 },
    legs: ['black', 'black', 'darkRed', 'brickYellow', 'brickYellow', 'brickYellow'],
    // a row of small spikes and a club at the end
    tail: { seg: 'darkRed', tip: 'black', plate: 'black', plateSize: (i, n) => (i === n - 1 ? 7 : 2.2), plateThick: (i, n) => (i === n - 1 ? 3.4 : 1.2) },
    build(part) {
      const R = 'darkRed', K = 'black', H = 'brickYellow';
      torso(part, R, 'tan');
      arms(part, K, H, K);
      // pauldrons, and two rows of spikes raked back along the spine
      for (const s of SIDES) {
        part('body', K, 3.2, 46, s * 5.2, 6, 2.4, 4.4, -0.2);
        part('body', H, 2.4, 48.2, s * 5.6, 1.3, 3.4, 1.3, 0.5);
        for (const [x, y, sz] of SPINE) {
          const len = sz * 1.25, off = len / 2 - 1;
          part('body', K, x - 0.78 * off, y + 0.62 * off, s * (1.2 + sz * 0.28), 1.5, len, 1.5, 0.9);
        }
      }
      skull(part, R, K, 'white');
      for (const s of SIDES) {
        // horns: a thick root and a tip hooked forward
        part('head', H, 8.4, 55, s * 2.9, 1.8, 4, 1.8, -0.25);
        part('head', H, 10.4, 57.8, s * 2.9, 1.2, 3.6, 1.2, -0.85);
        part('head', 'white', 14.4, 47.4, s * 2.5, 0.9, 2.2, 0.9);   // tusks
      }
      part('head', H, 16.2, 52.9, 0, 1.2, 2.4, 1.2, -0.3);           // nose horn
      jaw(part, K, 'white');
    },
  },
  {
    id: 'sea', name: 'Marina the Sea Beast', emoji: '\u{1F988}',
    eye: { color: 'lime', w: 1.5, h: 1.5 },
    legs: ['darkAzur', 'darkAzur', 'mediumAzur', 'white', 'white', 'white'],
    // fins down the tail, a fluke at the end
    tail: { seg: 'darkAzur', tip: 'mediumAzur', plate: 'mediumAzur', plateSize: (i, n) => (i === n - 1 ? 6.4 : 4.2 - i * 0.5), plateThick: () => 0.6 },
    build(part) {
      const A = 'darkAzur', M = 'mediumAzur', E = 'earthBlue', W = 'white';
      torso(part, A, W);
      arms(part, A, W, M);
      // one dorsal sail instead of plates: thin boards standing off the back, tallest over the shoulders
      const SAIL = [3.5, 7, 10, 10.5, 8, 4.5];
      SPINE.forEach(([x, y], i) => {
        const out = SAIL[i], off = out / 2 - 1.2;
        part('body', M, x - 0.83 * off, y + 0.56 * off, 0, out, 6.4, 0.7, -0.6);
        part('body', E, x - 0.83 * (out - 1.4), y + 0.56 * (out - 1.4), 0, 1, 6.4, 0.9, -0.6);   // the sail's dark edge
      });
      for (const s of SIDES) {
        for (let n = 0; n < 3; n++) part('body', E, 3.4 + n * 1.5, 42.6 - n * 0.4, s * 5.35, 0.6, 3.6, 0.5, -0.35);   // gill slits
        part('body', M, 9.2, 35.6, s * 7.9, 5, 4.2, 0.6, -0.25);                                                    // arm fins
        part('head', M, 7.4, 50.6, s * 4, 3.4, 4, 0.6, -0.5);                                                       // cheek fins
      }
      skull(part, A, E, W);
      part('head', M, 6.2, 55.2, 0, 5, 3.6, 0.7, -0.55);   // crest
      jaw(part, M, W);
    },
  },
  {
    id: 'shell', name: 'Shellback the Armoured', emoji: '\u{1F422}',
    eye: { color: 'brightBlue', w: 1.4, h: 1.4 },
    legs: ['brickYellow', 'brickYellow', 'darkOrange', 'reddishBrown', 'reddishBrown', 'reddishBrown'],
    tail: { seg: 'brickYellow', tip: 'darkOrange', plate: 'darkOrange', plateSize: (i) => 2.4 - i * 0.3, plateThick: () => 2 },
    build(part) {
      const Y = 'brickYellow', T = 'tan', O = 'darkOrange', N = 'reddishBrown';
      torso(part, Y, T);
      arms(part, Y, N, O);
      // a domed shell on the back: slabs stacked outward from the spine, wider than the body
      const sx = -0.976, sy = 0.218;   // out of the back, square to the leaning torso
      for (const [d, thick, tall, wide, c] of [[0, 5, 25, 16, O], [3.6, 3, 20, 13, N], [6.2, 2.6, 15, 10, O], [8.4, 2, 9, 6.4, N], [10, 1.4, 4, 3, O]]) {
        part('body', c, -4.2 + sx * d, 36.5 + sy * d, 0, thick, tall, wide, -0.22);
      }
      // the shell's rim over the shoulders and the hips
      part('body', N, -1.2, 49.4, 0, 6, 2, 13, -0.22);
      part('body', N, -7.4, 24.4, 0, 6, 2, 13, -0.22);
      skull(part, Y, O, null);
      // a blunt beak, hooked at the tip; no teeth
      part('head', O, 15.6, 50.2, 0, 3.6, 4.6, 5.8);
      part('head', N, 17.5, 48.4, 0, 1.4, 2.6, 3.2);
      part('head', O, 7.6, 54.2, 0, 4.6, 1.4, 5.2);        // skull plate
      part('jaw', O, 4.2, -0.7, 0, 9, 1.6, 4.8);
      part('jaw', N, 8.6, 0.2, 0, 1.2, 1.6, 3);
    },
  },
];

export const KAIJU_VARIANT_COUNT = KAIJU_VARIANTS.length;

/** The most static bricks any variant has: the rig's instance capacity. */
export const MAX_STATIC = KAIJU_VARIANTS.reduce((max, v) => { let n = 0; v.build(() => { n++; }); return Math.max(max, n); }, 0);
