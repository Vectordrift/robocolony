/**
 * Seeded pseudo-random number generator and noise functions.
 * Uses a simple mulberry32 PRNG for deterministic output.
 */
/**
 * Mulberry32 PRNG - fast, good quality 32-bit PRNG.
 * Returns a function that produces values in [0, 1).
 */
export function createRng(seed) {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Hash two coordinates into a deterministic seed value.
 * Combines seed, q, r into a single integer for noise lookup.
 */
function hashCoord(seed, q, r) {
    // Simple hash combining — based on Robert Jenkins' mix
    let h = seed;
    h = (h + q * 374761393) | 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = (h + r * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
}
/**
 * Get a deterministic noise value in [0, 1) for a hex coordinate.
 * Same seed + same coordinate always produces the same value.
 */
export function noiseAt(seed, q, r) {
    const h = hashCoord(seed, q, r);
    return h / 4294967296;
}
/**
 * Get multiple octaves of noise for richer terrain variation.
 * Higher octaves add finer detail.
 */
export function multiOctaveNoise(seed, q, r, octaves = 3) {
    let value = 0;
    let amplitude = 1;
    let totalAmplitude = 0;
    for (let i = 0; i < octaves; i++) {
        // Each octave uses a different seed offset and scaled coordinates
        const octaveSeed = seed + i * 31337;
        const scale = 1 << i; // 1, 2, 4, 8...
        value += noiseAt(octaveSeed, q * scale, r * scale) * amplitude;
        totalAmplitude += amplitude;
        amplitude *= 0.5;
    }
    return value / totalAmplitude;
}
//# sourceMappingURL=noise.js.map