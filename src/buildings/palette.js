// Colour tables for procedural buildings. Bold, varied Blox palette per zone (ARCHITECTURE §7).

export const RESI_BODY = ['brightRed', 'brightYellow', 'sandGreen', 'sandBlue', 'tan', 'brickYellow',
  'brightGreen', 'mediumLilac', 'brightOrange', 'white', 'lightStoneGrey', 'brightPink'];
export const RESI_ROOF = ['darkRed', 'darkGreen', 'darkStoneGrey', 'reddishBrown', 'darkOrange', 'earthBlue', 'black'];
export const RESI_TOWER_BODY = ['lightStoneGrey', 'white', 'tan', 'sandBlue', 'brickYellow', 'sandGreen'];
export const RESI_TOWER_ACCENT = ['brightRed', 'brightBlue', 'brightYellow', 'brightOrange', 'mediumLilac', 'lime'];

export const COMM_BODY = ['lightStoneGrey', 'white', 'mediumAzur', 'darkAzur', 'mediumStoneGrey', 'sandBlue', 'tan'];
export const COMM_ACCENT = ['brightRed', 'brightYellow', 'brightOrange', 'lime', 'brightPink', 'mediumLilac', 'brightBlue'];
export const COMM_GLASS = ['transClear', 'transBlue'];

export const IND_BODY_A = ['mediumStoneGrey', 'darkStoneGrey', 'tan'];
export const IND_BODY_B = ['darkStoneGrey', 'black', 'reddishBrown'];
export const IND_ACCENT = ['darkOrange', 'brightOrange', 'brightYellow'];

export function pick(rng, arr) { return rng.pick(arr); }
