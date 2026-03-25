/**
 * Hex map generation for RoboColony worlds.
 *
 * Generates a finite hex map with seeded terrain, resources, and colony starting positions.
 * All hexes are pre-generated at world creation for deterministic, reproducible worlds.
 */
import { hexesInRadius, hexDistanceFromOrigin, hexNeighbors, hexDistance } from './hex.js';
import { multiOctaveNoise, noiseAt, createRng } from './noise.js';
// --- Terrain Generation ---
/** Base resource yields per terrain type */
const TERRAIN_RESOURCES = {
    ocean: { food: 0, timber: 0, stone: 0, iron: 0 },
    coast: { food: 2, timber: 0, stone: 1, iron: 0 },
    plains: { food: 3, timber: 1, stone: 0, iron: 0 },
    forest: { food: 1, timber: 3, stone: 0, iron: 0 },
    mountains: { food: 0, timber: 0, stone: 3, iron: 2 },
    desert: { food: 0, timber: 0, stone: 1, iron: 1 },
    tundra: { food: 1, timber: 1, stone: 1, iron: 0 },
};
/**
 * Determine terrain type for a hex based on distance from center and noise.
 */
function assignTerrain(coord, radius, seed) {
    const dist = hexDistanceFromOrigin(coord);
    const distRatio = dist / radius;
    // Ocean boundary
    if (distRatio > 0.85)
        return 'ocean';
    // Coast zone
    if (distRatio > 0.75)
        return 'coast';
    // Interior terrain determined by noise
    const elevation = multiOctaveNoise(seed, coord.q, coord.r, 3);
    const moisture = multiOctaveNoise(seed + 10000, coord.q, coord.r, 3);
    const temperature = multiOctaveNoise(seed + 20000, coord.q, coord.r, 2);
    // Mountains: high elevation
    if (elevation > 0.72)
        return 'mountains';
    // Tundra: cold + moderate elevation
    if (temperature < 0.25 && elevation > 0.3)
        return 'tundra';
    // Desert: hot + low moisture
    if (temperature > 0.7 && moisture < 0.35)
        return 'desert';
    // Forest: high moisture
    if (moisture > 0.55)
        return 'forest';
    // Default: plains
    return 'plains';
}
/**
 * Calculate resource yields for a hex, adding noise variation.
 */
function assignResources(terrain, coord, seed) {
    const base = TERRAIN_RESOURCES[terrain];
    // Add ±1 variation per resource using noise
    const foodNoise = noiseAt(seed + 30000, coord.q, coord.r);
    const timberNoise = noiseAt(seed + 40000, coord.q, coord.r);
    const stoneNoise = noiseAt(seed + 50000, coord.q, coord.r);
    const ironNoise = noiseAt(seed + 60000, coord.q, coord.r);
    // Variation: -1 to +1
    const vary = (n) => Math.round(n * 2 - 1);
    return {
        food: Math.max(0, base.food + vary(foodNoise)),
        timber: Math.max(0, base.timber + vary(timberNoise)),
        stone: Math.max(0, base.stone + vary(stoneNoise)),
        iron: Math.max(0, base.iron + vary(ironNoise)),
    };
}
// --- Map Sizing ---
/**
 * Recommend a map radius based on colony count.
 * Smaller worlds = faster contact = more strategic tension.
 *
 * 2 colonies → radius 25 (~1,951 hexes)
 * 4 colonies → radius 35 (~3,851 hexes)
 * 8 colonies → radius 50 (~7,851 hexes)
 * 16 colonies → radius 70 (~15,351 hexes)
 */
export function recommendedRadius(maxColonies) {
    if (maxColonies <= 2)
        return 25;
    if (maxColonies <= 4)
        return 35;
    if (maxColonies <= 8)
        return 50;
    return 70;
}
/**
 * Calculate minimum spawn spacing based on colony count and radius.
 * For small worlds, colonies start closer to force early contact.
 */
export function recommendedMinSpacing(maxColonies, radius) {
    // Base: ~40% of radius, but never less than 8 (need room for starting resources)
    const base = Math.floor(radius * 0.4);
    // For 2 colonies we want them close: ~10-12 hexes apart
    // For 8+ we want spacing to prevent crowding
    const scaled = Math.max(8, Math.min(base, Math.floor(radius * 0.6 / Math.sqrt(maxColonies))));
    return scaled;
}
// --- Starting Position Selection ---
/**
 * Find suitable colony starting positions.
 * Positions are on a spawn ring that scales with radius and colony count.
 * Smaller worlds use a tighter ring (35-50% of radius) for faster contact.
 * Larger worlds use a wider ring (55-70% of radius) for more breathing room.
 */
export function findStartingPositions(hexes, radius, seed, maxColonies = 8, minSpacing) {
    const hexMap = new Map();
    for (const hex of hexes) {
        hexMap.set(`${hex.q},${hex.r}`, hex);
    }
    // Dynamic spawn ring: closer for small maps, wider for large
    // Small maps (r≤30): ring at 35-50% → colonies 7-15 hexes from center
    // Large maps (r≥50): ring at 55-70% → colonies 27-35 hexes from center
    const ringFactor = radius <= 30 ? { min: 0.35, max: 0.55 } :
        radius <= 40 ? { min: 0.45, max: 0.60 } :
            { min: 0.55, max: 0.70 };
    const spawnMin = Math.floor(radius * ringFactor.min);
    const spawnMax = Math.ceil(radius * ringFactor.max);
    // Use recommended spacing if not explicitly provided
    const effectiveMinSpacing = minSpacing ?? recommendedMinSpacing(maxColonies, radius);
    const landTerrains = ['plains', 'forest', 'tundra'];
    const candidates = [];
    for (const hex of hexes) {
        const dist = hexDistanceFromOrigin(hex);
        if (dist < spawnMin || dist > spawnMax)
            continue;
        if (!landTerrains.includes(hex.terrain))
            continue;
        // Check neighbors for food + timber access
        const neighbors = hexNeighbors(hex);
        let hasFood = false;
        let hasTimber = false;
        for (const n of neighbors) {
            const nh = hexMap.get(`${n.q},${n.r}`);
            if (nh) {
                if (nh.resources.food > 0)
                    hasFood = true;
                if (nh.resources.timber > 0)
                    hasTimber = true;
            }
        }
        // The hex itself also counts
        if (hex.resources.food > 0)
            hasFood = true;
        if (hex.resources.timber > 0)
            hasTimber = true;
        if (hasFood && hasTimber) {
            candidates.push({ q: hex.q, r: hex.r });
        }
    }
    // Sort candidates deterministically by seeded noise
    const rng = createRng(seed + 70000);
    const scored = candidates.map((c) => ({
        coord: c,
        score: rng(),
    }));
    scored.sort((a, b) => a.score - b.score);
    // Greedily pick positions with minimum spacing
    const positions = [];
    for (const { coord } of scored) {
        if (positions.length >= maxColonies)
            break;
        const tooClose = positions.some((p) => hexDistance(p, coord) < effectiveMinSpacing);
        if (!tooClose) {
            positions.push(coord);
        }
    }
    return positions;
}
// --- Main Generation ---
/**
 * Generate the complete world map.
 * Deterministic: same seed + radius always produces the same map.
 * If radius is not specified, it scales based on maxColonies.
 */
export function generateWorld(seed, radius, maxColonies = 8) {
    const effectiveRadius = radius ?? recommendedRadius(maxColonies);
    const coords = hexesInRadius(effectiveRadius);
    const hexes = coords.map((coord) => {
        const terrain = assignTerrain(coord, effectiveRadius, seed);
        const resources = assignResources(terrain, coord, seed);
        return { q: coord.q, r: coord.r, terrain, resources };
    });
    const startingPositions = findStartingPositions(hexes, effectiveRadius, seed, maxColonies);
    return { seed, radius: effectiveRadius, hexes, startingPositions };
}
/**
 * Get terrain distribution stats for a generated map.
 * Useful for testing and validation.
 */
export function getTerrainStats(hexes) {
    const stats = {};
    for (const hex of hexes) {
        stats[hex.terrain] = (stats[hex.terrain] || 0) + 1;
    }
    return stats;
}
//# sourceMappingURL=mapgen.js.map