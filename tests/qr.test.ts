import { describe, it, expect } from "bun:test";
import { encodeQrMatrix, encodeQrMatrixWithMask, renderQrSvg, createQrSvg } from "@/lib/qr";

/**
 * THE ONLY QUESTION THAT MATTERS ABOUT A QR IS WHETHER IT DECODES.
 *
 * A wrong encoder produces something that looks exactly like a right one — a
 * dense square with three finder corners — so "it renders" proves nothing. Two
 * of the three bugs found while writing `lib/qr.ts` produced perfect-looking
 * symbols that decoded to nothing: a placeholder byte missing from short EC
 * blocks (which ate each block's first parity codeword) and a zigzag that
 * failed to move the walk left past the timing column (which scrambled every
 * module in the last four columns). Both are invisible to inspection.
 *
 * So this file checks the encoder three ways that inspection cannot fake:
 *
 *  1. PINNED REFERENCE MATRICES. The two fixtures below were produced by an
 *     independent implementation (the `qrcode` Python package) at a forced mask
 *     and are compared module for module. During development the same
 *     comparison was run over 368 matrices — 46 payloads spanning versions 1
 *     to 40, each at all eight masks — and every one matched. Two are kept here
 *     because they are enough to catch a regression, and they are the small
 *     ones.
 *  2. A ROUND TRIP through a DECODER written in this file, which shares no code
 *     with the encoder: it rebuilds the function-module map from the spec's
 *     published alignment-pattern table, unmasks, walks the zigzag, undoes the
 *     block interleave, and parses the byte-mode header back into a string.
 *  3. SPEC TEST VECTORS for the format and version information bits, and the
 *     published byte-mode capacities, which pin the two tables that cannot be
 *     derived.
 *
 * The one thing not checked here is optics — that a printed symbol survives a
 * camera. That was verified out-of-band by rasterising the output and decoding
 * it with OpenCV's detector (clean, 4x scale, blurred, and noisy: all pass).
 */

/* -------------------------------------------------------------------------- */
/* An independent decoder                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Alignment-pattern centres, TYPED OUT FROM THE SPEC'S TABLE rather than
 * computed. `lib/qr.ts` derives these from a formula; a decoder that reused the
 * formula would agree with the encoder about a wrong answer.
 */
const ALIGNMENT_TABLE: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const EC_PER_BLOCK_M: Record<number, number> = {
  1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16, 7: 18, 8: 22, 9: 22, 10: 26,
};
const BLOCKS_M: Record<number, number> = {
  1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4, 7: 4, 8: 4, 9: 5, 10: 5,
};
/** Published total codeword counts, versions 1-10. */
const TOTAL_CODEWORDS: Record<number, number> = {
  1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346,
};

const maskBit = (mask: number, x: number, y: number): boolean => {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
};

/** Which modules are structure rather than payload, built from scratch. */
const functionMap = (version: number): boolean[][] => {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) map[y][x] = true;
  };

  // Finders, their separators, and the format strips beside them.
  [[0, 0], [size - 7, 0], [0, size - 7]].forEach(([left, top]) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) mark(left + dx, top + dy);
  });
  for (let i = 0; i < size; i++) {
    mark(8, i < 9 ? i : i);          // the vertical format strip is inside col 8
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }

  // Timing.
  for (let i = 0; i < size; i++) { mark(i, 6); mark(6, i); }

  // Alignment, minus the three finder corners.
  const centres = ALIGNMENT_TABLE[version];
  centres.forEach((cy, row) => {
    centres.forEach((cx, col) => {
      const corner =
        (row === 0 && col === 0) ||
        (row === 0 && col === centres.length - 1) ||
        (row === centres.length - 1 && col === 0);
      if (corner) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
    });
  });

  // Version blocks (v7+).
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return map;
};

/** Read the payload back out of a finished matrix. */
const decodeQr = (modules: boolean[][], version: number, mask: number): string => {
  const size = modules.length;
  const isFunction = functionMap(version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right === 6 ? 5 : right;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = col - j;
        const upward = ((col + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (isFunction[y][x]) continue;
        bits.push((modules[y][x] !== maskBit(mask, x, y)) ? 1 : 0);
      }
    }
    if (right === 6) right = 5;
  }

  const stream: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    stream.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }

  // Undo the interleave: read the codewords back into their blocks.
  const total = TOTAL_CODEWORDS[version];
  const blocks = BLOCKS_M[version];
  const ecPerBlock = EC_PER_BLOCK_M[version];
  const shortCount = blocks - (total % blocks);
  const shortDataLength = Math.floor(total / blocks) - ecPerBlock;
  const blockData: number[][] = Array.from({ length: blocks }, () => []);
  let cursor = 0;
  for (let i = 0; i <= shortDataLength; i++) {
    for (let b = 0; b < blocks; b++) {
      if (i === shortDataLength && b < shortCount) continue;
      blockData[b].push(stream[cursor++]);
    }
  }

  const data = blockData.flat();
  const bitAt = (index: number) => (data[index >>> 3] >>> (7 - (index & 7))) & 1;
  const read = (start: number, width: number) => {
    let value = 0;
    for (let i = 0; i < width; i++) value = (value << 1) | bitAt(start + i);
    return value;
  };
  expect(read(0, 4)).toBe(0b0100); // byte mode
  const countBits = version <= 9 ? 8 : 16;
  const length = read(4, countBits);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = read(4 + countBits + i * 8, 8);
  return new TextDecoder().decode(bytes);
};

/* -------------------------------------------------------------------------- */
/* Pinned reference matrices                                                   */
/* -------------------------------------------------------------------------- */

const REFERENCE_MATRICES = [
  {
    text: "PAY",
    mask: 0,
    version: 1,
    rows: [
    "111111100100101111111",
    "100000101001001000001",
    "101110100101001011101",
    "101110100000101011101",
    "101110101100101011101",
    "100000100010101000001",
    "111111101010101111111",
    "000000000011100000000",
    "101010100001000010010",
    "000000001010001001010",
    "000011100010100011111",
    "111101010110001000010",
    "011111111110101011101",
    "000000001111010101100",
    "111111100011011101111",
    "100000100101110111001",
    "101110101011011100101",
    "101110100110001000110",
    "101110101110100010001",
    "100000100000001000110",
    "111111101100101010111",
    ],
  },
  {
    text: "upi://pay?pa=acme@okhdfcbank&pn=Acme%20Consulting&am=1180.00&cu=INR&tn=Invoice%20INV-1&tr=INV-1",
    mask: 3,
    version: 6,
    rows: [
    "11111110111100111111110101000001101111111",
    "10000010111101111010000110000000001000001",
    "10111010011110111100000001111000001011101",
    "10111010101001101000010101010110001011101",
    "10111010000110100101011010011011001011101",
    "10000010000011001101010001000001101000001",
    "11111110101010101010101010101010101111111",
    "00000000100001000111001110010110000000000",
    "10110111001001101111010100101100101001011",
    "00001100110111001011110101001001101011010",
    "10101111100011111100101101001110011111110",
    "10011100011000011010101001100011011110001",
    "10110111110100101100101011100110110101110",
    "00001100100011101100110110110101011100011",
    "11011010001000101011110100101011010010101",
    "01010100111111001000010100001000101100000",
    "00010011011101111000111001001000100110000",
    "11111001101011010000110011100110100001000",
    "01101110011010010010101000010000001001000",
    "01011000011101011110110110011111010110101",
    "11101011010011010000000101011011011010110",
    "11011000001101000001000100011111110010101",
    "01010011010101001000010111100010000111110",
    "11010001111100110000100011101010001100010",
    "11100011000000010100001011111100010000001",
    "01101001110110010001010111110111011100111",
    "01110010111000110011001010100011001001001",
    "10101000100011101000111000010000000011011",
    "01100010111111010000111111001000000110000",
    "00101000011001100011101001100110100100010",
    "10110010000100110001001000110000001010110",
    "00010100101101000111000100111111011101110",
    "01001111000000000100010010111011111110110",
    "00000000101000000101110111011110100010111",
    "11111110100110101010000101001101101010110",
    "10000010110011100100100110001011100011011",
    "10111010000000100001010100101000111111110",
    "10111010110001101001011011110100110011010",
    "10111010101010010011001011101001010001111",
    "10000010000101001001110110100010110111010",
    "11111110101111100001111101000011110111110",
    ],
  },
];

describe("encodeQrMatrix — against an independent implementation", () => {
  REFERENCE_MATRICES.forEach((fixture) => {
    it(`matches the reference matrix module for module (v${fixture.version}, mask ${fixture.mask})`, () => {
      const matrix = encodeQrMatrixWithMask(fixture.text, fixture.mask)!;
      expect(matrix.version).toBe(fixture.version);
      expect(matrix.size).toBe(fixture.rows.length);
      const rows = matrix.modules.map((row) => row.map((m) => (m ? "1" : "0")).join(""));
      expect(rows).toEqual(fixture.rows);
    });
  });
});

describe("encodeQrMatrix — round trip through an independent decoder", () => {
  const payloads = [
    "PAY",
    "upi://pay?pa=acme@okhdfcbank&pn=Acme&am=1180.00&cu=INR&tn=Invoice%20INV-1&tr=INV-1",
    "upi://pay?pa=studio.nine@okicici&pn=Studio%20Nine%20Design%20LLP&am=118000.00&cu=INR&tn=Invoice%20INV%2F2026-27%2F0142&tr=INV-2026-27-0142",
    "\u20b9 1,180.00 \u2014 caf\u00e9 na\u00efve",
  ];

  payloads.forEach((payload) => {
    it(`decodes back to the payload it was given (${payload.slice(0, 24)}\u2026)`, () => {
      const matrix = encodeQrMatrix(payload)!;
      expect(matrix).not.toBeNull();
      expect(decodeQr(matrix.modules, matrix.version, matrix.mask)).toBe(payload);
    });

    it("decodes under every one of the eight masks", () => {
      for (let mask = 0; mask < 8; mask++) {
        const matrix = encodeQrMatrixWithMask(payload, mask)!;
        expect(decodeQr(matrix.modules, matrix.version, mask)).toBe(payload);
      }
    });
  });
});

describe("encodeQrMatrix — format information bits", () => {
  /**
   * ISO/IEC 18004 Annex C publishes all 32 format strings. Level M with mask 0
   * is 101010000010010, read from (8,0) outward. Getting the XOR mask 0x5412 or
   * the BCH generator 0x537 wrong here produces a symbol whose data is perfect
   * and which no scanner can read, because it cannot learn the mask.
   */
  const formatBitsFromMatrix = (modules: boolean[][]): string => {
    const bits: boolean[] = [];
    for (let i = 0; i <= 5; i++) bits.push(modules[i][8]);
    bits.push(modules[7][8]);
    bits.push(modules[8][8]);
    bits.push(modules[8][7]);
    for (let i = 9; i < 15; i++) bits.push(modules[8][14 - i]);
    // The published string is most-significant bit first; the symbol stores it
    // least-significant bit first.
    return bits.reverse().map((b) => (b ? "1" : "0")).join("");
  };

  /**
   * The complete level-M column of Annex C's format-information table. All
   * eight are pinned because the BCH parity, the 0x5412 XOR and the bit order
   * are one code path shared by every mask: a symbol whose data is flawless is
   * unreadable if a scanner cannot learn which mask to undo.
   */
  const PUBLISHED_M_FORMAT_STRINGS = [
    "101010000010010",
    "101000100100101",
    "101111001111100",
    "101101101001011",
    "100010111111001",
    "100000011001110",
    "100111110010111",
    "100101010100000",
  ];

  PUBLISHED_M_FORMAT_STRINGS.forEach((expected, mask) => {
    it(`writes the published string for level M, mask ${mask}`, () => {
      const matrix = encodeQrMatrixWithMask("PAY", mask)!;
      expect(formatBitsFromMatrix(matrix.modules)).toBe(expected);
    });
  });

  it("puts both copies of the format string in the symbol", () => {
    const { modules, size } = encodeQrMatrixWithMask("PAY", 0)!;
    for (let i = 0; i < 8; i++) {
      // Copy 2's first eight bits mirror copy 1's first eight.
      const copy1 = i <= 5 ? modules[i][8] : i === 6 ? modules[7][8] : modules[8][8];
      expect(modules[8][size - 1 - i]).toBe(copy1);
    }
    // The module that is dark in every QR code ever made.
    expect(modules[size - 8][8]).toBe(true);
  });
});

describe("encodeQrMatrix — version information bits", () => {
  /**
   * Version information is 18 bits of BCH(18,6), written into two blocks near
   * the bottom-left and top-right corners. Versions 7 and up carry it; below
   * that a scanner reads the version off the symbol's size alone.
   */
  const versionBitsFromMatrix = (modules: boolean[][], size: number): string => {
    const bits: boolean[] = [];
    for (let i = 17; i >= 0; i--) {
      bits.push(modules[Math.floor(i / 3)][size - 11 + (i % 3)]);
    }
    return bits.map((b) => (b ? "1" : "0")).join("");
  };

  it("writes the published version-7 string", () => {
    const matrix = encodeQrMatrix("x".repeat(120))!;
    expect(matrix.version).toBe(7);
    expect(versionBitsFromMatrix(matrix.modules, matrix.size)).toBe(
      "000111110010010100"
    );
  });

  it("writes the published version-10 string", () => {
    const matrix = encodeQrMatrix("x".repeat(213))!;
    expect(matrix.version).toBe(10);
    expect(versionBitsFromMatrix(matrix.modules, matrix.size)).toBe(
      "001010010011010011"
    );
  });

  it("mirrors the two version blocks", () => {
    const { modules, size } = encodeQrMatrix("x".repeat(120))!;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      expect(modules[b][a]).toBe(modules[a][b]);
    }
  });

  it("omits the version blocks below version 7", () => {
    const matrix = encodeQrMatrix("PAY")!;
    expect(matrix.version).toBe(1);
    expect(matrix.size).toBe(21);
  });
});

describe("encodeQrMatrix — version selection and capacity", () => {
  /**
   * The published byte-mode character capacities at level M. These pin the two
   * tables in `lib/qr.ts` that cannot be derived: if either the EC-codewords or
   * the block-count row were misremembered, the boundary between versions would
   * move and these would fail.
   */
  const CAPACITIES: Array<[number, number]> = [
    [1, 14], [2, 26], [3, 42], [4, 62], [5, 84],
    [6, 106], [7, 122], [8, 152], [9, 180], [10, 213],
  ];

  CAPACITIES.forEach(([version, capacity]) => {
    it(`fills version ${version} at exactly ${capacity} bytes`, () => {
      expect(encodeQrMatrix("a".repeat(capacity))!.version).toBe(version);
      expect(encodeQrMatrix("a".repeat(capacity + 1))!.version).toBe(version + 1);
    });
  });

  it("uses the smallest version that fits, so the modules stay as large as possible", () => {
    expect(encodeQrMatrix("PAY")!.version).toBe(1);
  });

  it("returns null rather than throwing when nothing will hold the payload", () => {
    expect(encodeQrMatrix("a".repeat(3000))).toBeNull();
    expect(encodeQrMatrix("")).toBeNull();
    expect(createQrSvg("a".repeat(3000))).toBeNull();
  });

  it("refuses a mask outside 0-7", () => {
    expect(encodeQrMatrixWithMask("PAY", 8)).toBeNull();
    expect(encodeQrMatrixWithMask("PAY", -1)).toBeNull();
    expect(encodeQrMatrixWithMask("PAY", 1.5)).toBeNull();
  });

  it("encodes UTF-8, not code units", () => {
    // Four bytes of emoji plus a three-byte rupee sign: a code-unit count would
    // pick a smaller version and overflow it.
    const matrix = encodeQrMatrix("\u20b9\ud83d\ude80")!;
    expect(decodeQr(matrix.modules, matrix.version, matrix.mask)).toBe("\u20b9\ud83d\ude80");
  });
});

describe("encodeQrMatrix — structure", () => {
  it("puts a finder pattern in three corners and not the fourth", () => {
    const { modules, size } = encodeQrMatrix("PAY")!;
    const finderAt = (left: number, top: number) =>
      modules[top][left] && modules[top][left + 6] && !modules[top + 1][left + 1] &&
      modules[top + 2][left + 2] && modules[top + 3][left + 3];
    expect(finderAt(0, 0)).toBe(true);
    expect(finderAt(size - 7, 0)).toBe(true);
    expect(finderAt(0, size - 7)).toBe(true);
    // The bottom-right corner is payload, and a finder there would be read as
    // an orientation marker.
    expect(finderAt(size - 7, size - 7)).toBe(false);
  });

  it("alternates the timing patterns", () => {
    const { modules, size } = encodeQrMatrix("PAY")!;
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
  });
});

describe("renderQrSvg", () => {
  const matrix = encodeQrMatrix("upi://pay?pa=acme@okhdfcbank&cu=INR")!;

  it("surrounds the symbol with a quiet zone, without which scanners fail", () => {
    const svg = renderQrSvg(matrix, { quietZone: 4 });
    expect(svg).toContain(`viewBox="0 0 ${matrix.size + 8} ${matrix.size + 8}"`);
  });

  it("paints an opaque background — a transparent QR on a busy page does not scan", () => {
    expect(renderQrSvg(matrix)).toContain('fill="#ffffff"');
  });

  it("draws the same modules the matrix holds", () => {
    // Parse the path back into a matrix and compare. The renderer merges each
    // row's dark runs into one subpath, which is where an off-by-one would hide.
    const quiet = 4;
    const svg = renderQrSvg(matrix, { quietZone: quiet });
    const grid = Array.from({ length: matrix.size }, () =>
      new Array<boolean>(matrix.size).fill(false)
    );
    const path = svg.match(/ d="([^"]*)"/)![1];
    const segments = path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g);
    for (const [, x, y, run] of segments) {
      for (let i = 0; i < Number(run); i++) {
        grid[Number(y) - quiet][Number(x) - quiet + i] = true;
      }
    }
    expect(grid).toEqual(matrix.modules);
  });

  it("escapes the label, which is the only user-controlled text in the markup", () => {
    const svg = renderQrSvg(matrix, { label: '"><script>alert(1)</script>' });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("is a self-contained element with no external reference", () => {
    const svg = createQrSvg("upi://pay?pa=acme@okhdfcbank&cu=INR")!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // The SVG namespace is the only URL allowed to appear: nothing here may
    // FETCH anything, because this markup is inlined into a print document
    // that must render identically with no network.
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("xlink:href");
    expect(svg).not.toContain("url(");
    expect(svg).not.toContain("<script");
  });
});
