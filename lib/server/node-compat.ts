/**
 * Node.js runtime compatibility shim — applied as a side effect on import.
 *
 * Node 24+ removed the long-deprecated `Buffer.SlowBuffer`, but an old transitive
 * dependency `buffer-equal-constant-time` (via jwa → jws, pulled in by
 * firebase-admin's gtoken) reads `require('buffer').SlowBuffer.prototype` at
 * module load and crashes with "Cannot read properties of undefined (reading
 * 'prototype')". This must run BEFORE firebase-admin is imported.
 *
 * Bun (used in the Docker image) still ships SlowBuffer, so production is
 * unaffected; this only matters on newer local Node.
 */

declare const globalThis: typeof global & { __slowBufferPolyfilled?: boolean };

if (
  !globalThis.__slowBufferPolyfilled &&
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null
) {
  try {
    // eval('require') retrieves the real CommonJS require at runtime without the
    // bundler rewriting the call, so we can mutate the actual `buffer` builtin.
    const nodeRequire = eval("require") as (id: string) => {
      SlowBuffer?: unknown;
      Buffer: typeof Buffer;
    };
    const bufferModule = nodeRequire("buffer");
    if (!bufferModule.SlowBuffer) {
      bufferModule.SlowBuffer = bufferModule.Buffer;
    }
    globalThis.__slowBufferPolyfilled = true;
  } catch {
    // If require is unavailable (e.g. edge runtime), there is nothing to patch —
    // firebase-admin does not run there.
  }
}

export {};
