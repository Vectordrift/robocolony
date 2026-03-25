/**
 * Seeded pseudo-random number generator and noise functions.
 * Uses a simple mulberry32 PRNG for deterministic output.
 */
/**
 * Mulberry32 PRNG - fast, good quality 32-bit PRNG.
 * Returns a function that produces values in [0, 1).
 */
export declare function createRng(seed: number): () => number;
/**
 * Get a deterministic noise value in [0, 1) for a hex coordinate.
 * Same seed + same coordinate always produces the same value.
 */
export declare function noiseAt(seed: number, q: number, r: number): number;
/**
 * Get multiple octaves of noise for richer terrain variation.
 * Higher octaves add finer detail.
 */
export declare function multiOctaveNoise(seed: number, q: number, r: number, octaves?: number): number;
//# sourceMappingURL=noise.d.ts.map