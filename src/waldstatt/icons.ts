/**
 * Small pixel pictures as colour grids, for the toolbox, the Waldmensch's
 * portrait and the app icon. One character per pixel; "." is transparent.
 * Used at build time by Icon.astro and the icon endpoints.
 */

const colors: Record<string, string> = {
  D: "#5a3a20",
  W: "#9a6a3c",
  E: "#e2bd84",
  R: "#b98a52",
  P: "#efe0b9",
  Q: "#c9b082",
  K: "#4a3626",
  S: "#f6f1e3",
  G: "#7a7064",
  H: "#2f5d34",
  F: "#e2b58a",
  B: "#a8432f",
  T: "#4a3b2b",
  A: "#c9ccd1",
  e: "#3a2a20",
  w: "#ffffff",
  l: "#2f6b3c",
  m: "#22552f",
  d: "#173f23",
  o: "#0f2c18",
  g: "#1c3420",
  r: "#a8323a",
  N: "#9aa0a6",
  M: "#5f646b",
  Y: "#e3c45a",
  y: "#a8862c",
  C: "#f4efe4",
  c: "#cfc4ae",
  Z: "#c47a3a",
  z: "#8a4f22",
  X: "#b8443a",
  x: "#f1d6c8",
  k: "#d9a02a",
  f: "#fbf6e9",
  u: "#e8c050",
};

export const icons: Record<string, string[]> = {
  stones: [
    "....AAA.....",
    "...AANNA....",
    "..ANNNNNM...",
    "..MNNNNMM.A.",
    ".AAMMMM..ANA",
    "ANNNA...ANNM",
    "NNNNNM..MNMM",
    ".MMMM.......",
  ],
  pave: [
    "AANAANAANAA.",
    "NNMNNMNNMNN.",
    "MMMMMMMMMMM.",
    ".AANAANAANAA",
    ".NNMNNMNNMNN",
    ".MMMMMMMMMMM",
    "AANAANAANAA.",
    "NNMNNMNNMNN.",
  ],
  wood: [
    "...DDDDDDDD.",
    "..DWWWWWWWEE",
    "..DWWWWWWERE",
    "..DDDDDDDDEE",
    "DDDDDDDD....",
    "DWWWWWWEE...",
    "DWWWWWERE...",
    "DDDDDDDEE...",
  ],
  parchment: [
    ".DPPPPPPPPD.",
    ".DPKKKKKKQD.",
    "..PPPPPPPQ..",
    "..PKKKKKPQ..",
    "..PPPPPPPQ..",
    "..PKKKKKKQ..",
    ".DPPPPPPPPD.",
    ".DQQQQQQQQD.",
  ],
  books: [
    "............",
    ".BBBBBBBBPP.",
    ".BEEBBBBBPP.",
    ".HHHHHHHHHPP",
    ".HEEHHHHHHPP",
    "..DDDDDDDDPP",
    "..DEEDDDDDPP",
    "............",
  ],
  workers: [
    "...HHHHH....",
    "..HHHHHHH...",
    "...FFFFe....",
    "...FFFFF....",
    "..BBBBBBB...",
    "..BBBBBBB...",
    "...TT.TT....",
    "...TT.TT....",
  ],
  axe: [
    "....AAA.....",
    "...AAAAW....",
    "....AAW.....",
    "......W.....",
    ".......W....",
    "........W...",
    ".........W..",
    "..........W.",
  ],
  saw: [
    "WW..........",
    "WWAAAAAAAAA.",
    "WWAAAAAAAAAA",
    "WW.A.A.A.A.A",
    "............",
    "............",
    "............",
    "............",
  ],
  demolish: [
    "....AAAA....",
    "...AAAAAA...",
    "....AAAA....",
    ".....WW.....",
    ".....WW.....",
    ".rr..WW..rr.",
    "rrrr.WW.rrrr",
    ".rr..WW..rr.",
  ],
  build: [
    ".....rr.....",
    "....rrrr....",
    "...rrrrrr...",
    "..rrrrrrrr..",
    "..WWWWWWWW..",
    "..WWDDWWWW..",
    "..WWDDWWWW..",
    "..WWDDWWWW..",
  ],
  grain: [
    "..Y...Y...Y.",
    ".YyY.YyY.YyY",
    "..Y...Y...Y.",
    ".YyY.YyY.YyY",
    "..Y...Y...Y.",
    "...y..y..y..",
    "....y.y.y...",
    ".....yyy....",
  ],
  flour: [
    "....DDDD....",
    "...DCCCCD...",
    "..DCCCCCCD..",
    ".DCCcCCcCCD.",
    ".DCCCCCCCCD.",
    ".DCCCcCCCCD.",
    ".DCCCCCCCCD.",
    "..DDDDDDDD..",
  ],
  bread: [
    "............",
    "...ZZZZZZ...",
    "..ZuZZuZZZ..",
    ".ZZZZZZZZZZ.",
    ".ZuZZuZZuZZ.",
    ".ZZZZZZZZZZ.",
    "..zzzzzzzz..",
    "............",
  ],
  meat: [
    "............",
    "...XXXXX....",
    "..XXxXXXX...",
    ".XXXXXxXXX..",
    ".XXxXXXXXXCC",
    "..XXXXXXX.CC",
    "...XXXXX....",
    "............",
  ],
  beer: [
    "..ffffff....",
    ".ffffffff...",
    ".kkkkkkkWW..",
    ".kukkukkW.W.",
    ".kkkkkkkW.W.",
    ".kkukkkkWW..",
    ".kkkkkkkW...",
    ".WWWWWWW....",
  ],
  beds: [
    "............",
    "....rr......",
    "...rrrr.....",
    "..rrrrrr....",
    ".rrrrrrrr...",
    "..WWWWWW....",
    "..WWDDWW....",
    "..WWDDWW....",
  ],
  mood: [
    "...uuuuuu...",
    "..uuuuuuuu..",
    ".uueuuuueuu.",
    ".uuuuuuuuuu.",
    ".ueuuuuuueu.",
    ".uueeeeeeuu.",
    "..uuuuuuuu..",
    "...uuuuuu...",
  ],
  waldmensch: [
    "..gggggggggg..",
    ".gggHHHHHHgggg",
    ".ggHHHHHHHHggg",
    ".gHHHHHHHHHHgg",
    ".gggFFFFFFgggg",
    ".gggFeFFeFgggg",
    ".gggFFFFFFgggg",
    ".gggFFTTFFgggg",
    ".ggggFFFFggggg",
    ".ggBBBBBBBBggg",
    ".gBBBBBBBBBBgg",
    ".gBBBBBBBBBBgg",
    ".gBBBBBBBBBBgg",
    "..gggggggggg..",
  ],
  app: [
    "gggggggggggggggg",
    "gggggggllggggggg",
    "ggggggglmggggggg",
    "gggggglllmgggggg",
    "ggggggllmmgggggg",
    "gggggllllmmggggg",
    "ggggglllmmmggggg",
    "gggglllllmmmgggg",
    "ggggglllmmmggggg",
    "gggglllllmmmgggg",
    "gggllllllmmmmggg",
    "ggllllllmmmmmmgg",
    "gooooooooooooogg",
    "gggggggDDggggggg",
    "gggggggDDggggggg",
    "gggggggggggggggg",
  ],
};

export type IconName = keyof typeof icons;

/** The pixels of an icon as runs of one colour per row. */
export function runs(name: IconName) {
  const rows = icons[name];
  const result: { x: number; y: number; w: number; color: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const char = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === char) end++;
      if (char !== ".") result.push({ x, y, w: end - x, color: colors[char] });
      x = end;
    }
  });
  return { width: rows[0].length, height: rows.length, runs: result };
}

/** The colour of an icon pixel, or null if transparent. */
export function pixel(name: IconName, x: number, y: number): string | null {
  const char = icons[name][y]?.[x] ?? ".";
  return char === "." ? null : colors[char];
}
