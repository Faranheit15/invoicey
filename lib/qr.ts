/**
 * A QR encoder, written out by hand.
 *
 * WHY THIS EXISTS AT ALL: the only thing this app needs a QR for is the
 * `upi://pay` URI in `lib/upi.ts`, and that URI is short, always ASCII-safe
 * after encoding, and always printed at one size. A QR library is 20-40 kB of
 * client bundle plus a supply-chain surface, for a feature whose entire value
 * is that it costs nothing (no gateway, no account, no fee, no dependency).
 * So the encoder is here, and it is deliberately narrow:
 *
 *   - byte mode only (the URI is bytes; alphanumeric mode cannot hold `:` `/`
 *     lowercase or `%`, so it would never be selected anyway),
 *   - error-correction level M only (the payments convention: ~15% recovery,
 *     which survives a phone camera at an angle and a printer that smears),
 *   - versions 1-40, smallest that fits.
 *
 * WHAT IT IS NOT: it does not do kanji/alphanumeric/numeric segments, ECI,
 * structured append, or micro-QR. If a payload ever needs those, use a library
 * rather than growing this file.
 *
 * The structure below follows the reference algorithm in ISO/IEC 18004 and is
 * organised the way Project Nayuki's well-known reference implementation
 * organises it, because that layout is the one every other implementation can
 * be checked against — which is exactly what was done: every matrix this file
 * produces, for every mask, was compared module-for-module against an
 * independent reference encoder before it shipped (see `tests/qr.test.ts` for
 * the invariants that are checked on every run).
 *
 * Coordinates are (x = column, y = row) THROUGHOUT. The single most common way
 * to get a QR subtly wrong is to transpose them halfway through, so there is
 * one convention and it never changes; `toRows()` is the only place that
 * flips into row-major output.
 */

/* -------------------------------------------------------------------------- */
/* Spec tables                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * EC codewords per block, level M, indexed by version (index 0 is unused).
 *
 * This is a table from the spec; it cannot be derived. Together with
 * `NUM_BLOCKS_M` it fixes the data capacity of every version — see
 * `dataCodewordsFor`, and the capacity assertions in the tests, which pin
 * these two arrays against the published byte-mode character capacities.
 */
const EC_CODEWORDS_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26,
  26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28,
];

/** Number of interleaved EC blocks, level M, indexed by version. */
const NUM_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
  18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** Level M's two format bits. L=01, M=00, Q=11, H=10 — M is the zero case. */
const FORMAT_EC_BITS_M = 0;

/** Byte mode's 4-bit mode indicator. */
const MODE_BYTE = 0b0100;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

const sizeForVersion = (version: number) => version * 4 + 17;

/**
 * Total modules available to data + EC, before codeword framing.
 *
 * Derived rather than tabulated: it is the full grid minus the function
 * patterns, and every term below is a shape you can point at on the symbol —
 * three 8x8 finder-plus-separator corners, the two format strips and the dark
 * module, the two timing lines, the alignment grid, and (v7+) the two version
 * blocks. Deriving it means the table above is the ONLY thing that has to be
 * remembered correctly.
 */
const rawDataModulesFor = (version: number): number => {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) {
      result -= 36;
    }
  }
  return result;
};

const dataCodewordsFor = (version: number): number =>
  Math.floor(rawDataModulesFor(version) / 8) -
  EC_CODEWORDS_PER_BLOCK_M[version] * NUM_BLOCKS_M[version];

/**
 * Alignment-pattern centre coordinates for a version.
 *
 * The spec prints these as a table; the closed form below reproduces it
 * exactly, including the one irregular case (version 32) that the formula
 * misses. The first centre is always 6, the last is always size - 7, and the
 * ones between are evenly spaced by an even step.
 */
const alignmentPositionsFor = (version: number): number[] => {
  if (version === 1) {
    return [];
  }
  const count = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = version * 4 + 10; positions.length < count; pos -= step) {
    positions.splice(1, 0, pos);
  }
  return positions;
};

/** Bit width of the character-count field for byte mode at this version. */
const charCountBitsFor = (version: number) => (version <= 9 ? 8 : 16);

const getBit = (value: number, index: number) => ((value >>> index) & 1) !== 0;

/* -------------------------------------------------------------------------- */
/* GF(256) and Reed-Solomon                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Multiply in GF(256) with the QR field's primitive polynomial x^8+x^4+x^3+x^2+1
 * (0x11D). Russian-peasant multiplication with the reduction folded in, so
 * there are no log/antilog tables to get out of step with each other.
 */
const gfMultiply = (a: number, b: number): number => {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((b >>> i) & 1) * a;
  }
  return result & 0xff;
};

/** The RS generator polynomial of the given degree, as coefficients (monic, leading term implicit). */
const reedSolomonDivisor = (degree: number): number[] => {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  // Multiply by (x - r^i) for i in 0..degree-1, where r = 0x02 is a generator
  // of the field's multiplicative group.
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
};

/** The remainder of `data` divided by the divisor — i.e. the EC codewords. */
const reedSolomonRemainder = (data: number[], divisor: number[]): number[] => {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
};

/* -------------------------------------------------------------------------- */
/* Bit buffer                                                                  */
/* -------------------------------------------------------------------------- */

class BitBuffer {
  private readonly bits: number[] = [];

  get length(): number {
    return this.bits.length;
  }

  append(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  toBytes(): number[] {
    const bytes = new Array<number>(Math.ceil(this.bits.length / 8)).fill(0);
    this.bits.forEach((bit, index) => {
      bytes[index >>> 3] |= bit << (7 - (index & 7));
    });
    return bytes;
  }
}

/* -------------------------------------------------------------------------- */
/* Codeword assembly                                                           */
/* -------------------------------------------------------------------------- */

/** Smallest version at level M that holds `byteLength` bytes in byte mode, or null. */
const chooseVersion = (byteLength: number): number | null => {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const capacityBits = dataCodewordsFor(version) * 8;
    const neededBits = 4 + charCountBitsFor(version) + byteLength * 8;
    if (neededBits <= capacityBits) {
      return version;
    }
  }
  return null;
};

const buildDataCodewords = (bytes: number[], version: number): number[] => {
  const capacityBits = dataCodewordsFor(version) * 8;
  const buffer = new BitBuffer();
  buffer.append(MODE_BYTE, 4);
  buffer.append(bytes.length, charCountBitsFor(version));
  bytes.forEach((byte) => buffer.append(byte, 8));

  // Terminator: up to four zero bits, then zero-fill to the byte boundary.
  buffer.append(0, Math.min(4, capacityBits - buffer.length));
  buffer.append(0, (8 - (buffer.length % 8)) % 8);

  // Pad with the spec's alternating pad codewords. They are 0xEC/0x11 and not
  // zeroes on purpose: a long zero run is exactly the kind of uniform region
  // the mask penalty is trying to avoid.
  const codewords = buffer.toBytes();
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
};

/**
 * Split into blocks, compute each block's EC, and interleave both halves.
 *
 * The interleave is the whole point of blocks: a scuff that destroys 30
 * consecutive modules is spread across every block as a few errors each,
 * instead of wiping one block past its correction limit.
 */
const addEccAndInterleave = (data: number[], version: number): number[] => {
  const numBlocks = NUM_BLOCKS_M[version];
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK_M[version];
  const totalCodewords = Math.floor(rawDataModulesFor(version) / 8);
  const shortBlockCount = numBlocks - (totalCodewords % numBlocks);
  const shortBlockDataLength = Math.floor(totalCodewords / numBlocks) - ecPerBlock;

  const divisor = reedSolomonDivisor(ecPerBlock);
  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const isShort = i < shortBlockCount;
    const length = shortBlockDataLength + (isShort ? 0 : 1);
    const dataPart = data.slice(offset, offset + length);
    offset += length;
    const ec = reedSolomonRemainder(dataPart, divisor);
    // A short block gets a PLACEHOLDER byte between its data and its EC so
    // every block is the same length and the column-wise read below lines up.
    // The placeholder is skipped on the way out; without it the skip would eat
    // the block's first real EC codeword, which produces a symbol that looks
    // perfect and decodes to nothing.
    blocks.push(isShort ? [...dataPart, 0, ...ec] : [...dataPart, ...ec]);
  }

  const result: number[] = [];
  const longest = shortBlockDataLength + 1 + ecPerBlock;
  for (let i = 0; i < longest; i++) {
    blocks.forEach((block, blockIndex) => {
      if (i !== shortBlockDataLength || blockIndex >= shortBlockCount) {
        result.push(block[i]);
      }
    });
  }
  return result;
};

/* -------------------------------------------------------------------------- */
/* The symbol                                                                  */
/* -------------------------------------------------------------------------- */

class QrSymbol {
  readonly size: number;
  /** modules[y][x] — true is dark. */
  private readonly modules: boolean[][];
  /** Function modules are never masked and never carry data. */
  private readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = sizeForVersion(version);
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false)
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false)
    );
  }

  private set(x: number, y: number, isDark: boolean): void {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }

    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = alignmentPositionsFor(this.version);
    positions.forEach((y, row) => {
      positions.forEach((x, column) => {
        // The three finder corners already own their space.
        const isFinderCorner =
          (row === 0 && column === 0) ||
          (row === 0 && column === positions.length - 1) ||
          (row === positions.length - 1 && column === 0);
        if (!isFinderCorner) {
          this.drawAlignment(x, y);
        }
      });
    });

    // Reserve the format area; the real bits go in once a mask is chosen.
    this.drawFormatBits(0);
    this.drawVersionBits();
  }

  private drawFinder(centerX: number, centerY: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = centerX + dx;
        const y = centerY + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          // Concentric by Chebyshev distance: 0-1 is the dark 3x3 core, 2 is
          // the light ring, 3 is the dark outer ring, 4 is the separator. So
          // every ring is dark except 2 and 4.
          this.set(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignment(centerX: number, centerY: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.set(
          centerX + dx,
          centerY + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1
        );
      }
    }
  }

  /** The 15-bit format string: 5 data bits, BCH(15,5) parity, XOR mask 0x5412. */
  drawFormatBits(mask: number): void {
    const data = (FORMAT_EC_BITS_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = (((data << 10) | remainder) ^ 0x5412) & 0x7fff;

    // Copy 1, wrapped around the top-left finder.
    for (let i = 0; i <= 5; i++) {
      this.set(8, i, getBit(bits, i));
    }
    this.set(8, 7, getBit(bits, 6));
    this.set(8, 8, getBit(bits, 7));
    this.set(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) {
      this.set(14 - i, 8, getBit(bits, i));
    }

    // Copy 2, split between the other two finders.
    for (let i = 0; i < 8; i++) {
      this.set(this.size - 1 - i, 8, getBit(bits, i));
    }
    for (let i = 8; i < 15; i++) {
      this.set(8, this.size - 15 + i, getBit(bits, i));
    }
    // The one module that is always dark, in every symbol ever made.
    this.set(8, this.size - 8, true);
  }

  /** The 18-bit version string: 6 data bits, BCH(18,6) parity. Version 7 and up. */
  private drawVersionBits(): void {
    if (this.version < 7) {
      return;
    }
    let remainder = this.version;
    for (let i = 0; i < 12; i++) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const isDark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, isDark);
      this.set(b, a, isDark);
    }
  }

  /**
   * Lay the codeword stream into the two-module-wide serpentine, bottom-right
   * to top-left, skipping function modules and the vertical timing column.
   */
  drawCodewords(codewords: number[]): void {
    let bitIndex = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      // The vertical timing line owns column 6, so the pair that would have
      // straddled it shifts left by one AND the walk continues from there —
      // reassigning `right` rather than aliasing it is load-bearing, or the
      // remaining pairs overlap each other and every module left of the timing
      // line lands in the wrong place.
      if (right === 6) {
        right = 5;
      }
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && bitIndex < codewords.length * 8) {
            this.modules[y][x] = getBit(
              codewords[bitIndex >>> 3],
              7 - (bitIndex & 7)
            );
            bitIndex++;
          }
          // Anything past the stream stays light: those are the remainder bits,
          // which the spec defines as zero.
        }
      }
    }
  }

  /** XOR the mask over every non-function module. Applying twice undoes it. */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) {
          continue;
        }
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
        }
        if (invert) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  /**
   * The spec's four penalty rules. Lower is better; the chosen mask is the one
   * that leaves the fewest scanner-confusing features — long same-colour runs,
   * solid 2x2 blocks, anything that looks like a finder pattern, and a
   * dark/light balance far from 50%.
   */
  penaltyScore(): number {
    let result = 0;

    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runLength = 0;
      let history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runLength++;
          if (runLength === 5) {
            result += PENALTY_N1;
          } else if (runLength > 5) {
            result++;
          }
        } else {
          history = this.pushRun(runLength, history);
          if (!runColor) {
            result += this.countFinderLikePatterns(history) * PENALTY_N3;
          }
          runColor = this.modules[y][x];
          runLength = 1;
        }
      }
      result +=
        this.terminateRunAndCount(runColor, runLength, history) * PENALTY_N3;
    }

    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runLength = 0;
      let history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runLength++;
          if (runLength === 5) {
            result += PENALTY_N1;
          } else if (runLength > 5) {
            result++;
          }
        } else {
          history = this.pushRun(runLength, history);
          if (!runColor) {
            result += this.countFinderLikePatterns(history) * PENALTY_N3;
          }
          runColor = this.modules[y][x];
          runLength = 1;
        }
      }
      result +=
        this.terminateRunAndCount(runColor, runLength, history) * PENALTY_N3;
    }

    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += PENALTY_N2;
        }
      }
    }

    let dark = 0;
    this.modules.forEach((row) => {
      row.forEach((module) => {
        if (module) {
          dark++;
        }
      });
    });
    const total = this.size * this.size;
    const deviation = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + deviation * PENALTY_N4;
  }

  private pushRun(runLength: number, history: number[]): number[] {
    // The symbol's edge counts as an unbounded light run, so the very first
    // run recorded in a line gets the border added to it.
    const length = history[0] === 0 ? runLength + this.size : runLength;
    return [length, ...history.slice(0, history.length - 1)];
  }

  private terminateRunAndCount(
    runColor: boolean,
    runLength: number,
    history: number[]
  ): number {
    let next = history;
    let length = runLength;
    if (runColor) {
      next = this.pushRun(length, next);
      length = 0;
    }
    next = this.pushRun(length + this.size, next);
    return this.countFinderLikePatterns(next);
  }

  /** How many 1:1:3:1:1 finder-lookalikes (with their light margin) end here. */
  private countFinderLikePatterns(history: number[]): number {
    const n = history[1];
    const core =
      n > 0 &&
      history[2] === n &&
      history[3] === n * 3 &&
      history[4] === n &&
      history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  }

  toRows(): boolean[][] {
    return this.modules.map((row) => [...row]);
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface QrMatrix {
  /** Symbol version, 1-40. */
  version: number;
  /** Side length in modules, excluding the quiet zone. */
  size: number;
  /** The chosen mask pattern, 0-7. */
  mask: number;
  /** Row-major, `modules[y][x]`, true is dark. */
  modules: boolean[][];
}

/**
 * Encode a string as a QR matrix at EC level M, or null if it will not fit.
 *
 * Returns null rather than throwing: a caller printing an invoice should drop
 * the QR and keep the invoice, not lose the document to an exception.
 */
const buildSymbol = (text: string): QrSymbol | null => {
  if (!text) {
    return null;
  }
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length);
  if (version === null) {
    return null;
  }

  const symbol = new QrSymbol(version);
  symbol.drawFunctionPatterns();
  symbol.drawCodewords(
    addEccAndInterleave(buildDataCodewords(bytes, version), version)
  );
  return symbol;
};

export const encodeQrMatrix = (text: string): QrMatrix | null => {
  const symbol = buildSymbol(text);
  if (!symbol) {
    return null;
  }

  // Try all eight masks and keep the best. The mask is not cosmetic: an
  // unfortunate one produces regions a scanner reads as a finder pattern.
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    symbol.applyMask(mask);
    symbol.drawFormatBits(mask);
    const penalty = symbol.penaltyScore();
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    symbol.applyMask(mask);
  }
  symbol.applyMask(bestMask);
  symbol.drawFormatBits(bestMask);

  return {
    version: symbol.version,
    size: symbol.size,
    mask: bestMask,
    modules: symbol.toRows(),
  };
};

/**
 * Encode with a caller-chosen mask instead of the penalty-scored one.
 *
 * This exists for verification, not for production callers. All eight masks of
 * a payload are valid, decodable symbols that differ only in which one a
 * scanner finds easiest; forcing the mask is what makes this encoder
 * comparable, module for module, against an independent implementation whose
 * mask-selection heuristic may differ in the tie-breaks. `tests/qr.test.ts`
 * pins captured reference matrices through this entry point.
 */
export const encodeQrMatrixWithMask = (
  text: string,
  mask: number
): QrMatrix | null => {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    return null;
  }
  const symbol = buildSymbol(text);
  if (!symbol) {
    return null;
  }
  symbol.applyMask(mask);
  symbol.drawFormatBits(mask);
  return {
    version: symbol.version,
    size: symbol.size,
    mask,
    modules: symbol.toRows(),
  };
};

export interface QrSvgOptions {
  /** Light modules around the symbol. Four is the spec's minimum; below that scanners fail. */
  quietZone?: number;
  /** Rendered edge length in CSS pixels. */
  pixelSize?: number;
  /** Dark module colour. Must be dark on light — inverted QRs do not scan reliably. */
  darkColor?: string;
  /** Background colour. A transparent background over a busy page does not scan. */
  lightColor?: string;
  /** Accessible name. Escaped before it reaches the markup. */
  label?: string;
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * Render a matrix as a standalone `<svg>` string.
 *
 * SVG, not canvas: this has to work in a Node/Bun render path and inside a
 * sandboxed, script-free print iframe, and it has to stay crisp on a printer
 * at whatever DPI the user's driver picks. A raster would blur; a canvas would
 * need a script the print frame deliberately does not allow.
 *
 * One `<path>` holds every dark module. Thousands of `<rect>` elements would
 * be several times the bytes and give some print pipelines hairline seams
 * between adjacent modules, which reads to a scanner as a broken module.
 */
export const renderQrSvg = (
  matrix: QrMatrix,
  options: QrSvgOptions = {}
): string => {
  const quietZone = Math.max(0, Math.round(options.quietZone ?? 4));
  const dark = options.darkColor ?? "#111827";
  const light = options.lightColor ?? "#ffffff";
  const extent = matrix.size + quietZone * 2;

  const segments: string[] = [];
  matrix.modules.forEach((row, y) => {
    let runStart = -1;
    row.forEach((isDark, x) => {
      if (isDark && runStart < 0) {
        runStart = x;
      }
      if (!isDark && runStart >= 0) {
        segments.push(
          `M${runStart + quietZone} ${y + quietZone}h${x - runStart}v1h-${x - runStart}z`
        );
        runStart = -1;
      }
    });
    if (runStart >= 0) {
      const width = row.length - runStart;
      segments.push(
        `M${runStart + quietZone} ${y + quietZone}h${width}v1h-${width}z`
      );
    }
  });

  const dimension =
    options.pixelSize && options.pixelSize > 0
      ? ` width="${Math.round(options.pixelSize)}" height="${Math.round(
          options.pixelSize
        )}"`
      : "";
  const label = options.label
    ? ` role="img" aria-label="${escapeXml(options.label)}"`
    : ' role="img" aria-label="QR code"';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"` +
    `${dimension}${label} shape-rendering="crispEdges">` +
    `<rect width="${extent}" height="${extent}" fill="${light}"/>` +
    `<path d="${segments.join("")}" fill="${dark}"/>` +
    `</svg>`
  );
};

/** Encode and render in one step. Null when the payload will not fit. */
export const createQrSvg = (
  text: string,
  options: QrSvgOptions = {}
): string | null => {
  const matrix = encodeQrMatrix(text);
  return matrix ? renderQrSvg(matrix, options) : null;
};
