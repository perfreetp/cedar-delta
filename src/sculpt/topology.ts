export interface NeighborEdge {
  neighbor: number;
  /** Third vertex for every triangle sharing this edge (one or two). */
  opposites: number[];
}

export interface Topology {
  neighbors: Uint32Array[];
  edges: NeighborEdge[][];
  triangleCount: number;
}

interface EdgeRecord {
  a: number;
  b: number;
  opposites: number[];
}

/**
 * Builds the one-ring adjacency and edge/triangle correspondence used by the
 * weighted smooth brush. The geometry is expected to be indexed and welded.
 */
export function buildTopology(
  index: ArrayLike<number> | null | undefined,
  vertexCount: number,
): Topology {
  const edgeMap = new Map<string, EdgeRecord>();
  let triangleCount = 0;

  const addEdge = (a: number, b: number, opposite: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    let record = edgeMap.get(key);
    if (!record) {
      record = { a: lo, b: hi, opposites: [] };
      edgeMap.set(key, record);
    }
    if (!record.opposites.includes(opposite)) {
      record.opposites.push(opposite);
    }
  };

  const triangleCountFromIndex = index
    ? Math.floor(index.length / 3)
    : Math.floor(vertexCount / 3);

  for (let t = 0; t < triangleCountFromIndex; t += 1) {
    let a: number;
    let b: number;
    let c: number;
    if (index) {
      a = index[t * 3];
      b = index[t * 3 + 1];
      c = index[t * 3 + 2];
    } else {
      a = t * 3;
      b = t * 3 + 1;
      c = t * 3 + 2;
    }
    if (a === b || b === c || a === c) continue;
    triangleCount += 1;
    addEdge(a, b, c);
    addEdge(b, c, a);
    addEdge(c, a, b);
  }

  const edgeLists: NeighborEdge[][] = Array.from({ length: vertexCount }, () => []);
  const neighborSets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set());

  edgeMap.forEach((record) => {
    const edge: NeighborEdge = { neighbor: record.b, opposites: record.opposites };
    const reverse: NeighborEdge = { neighbor: record.a, opposites: record.opposites };
    edgeLists[record.a]?.push(edge);
    edgeLists[record.b]?.push(reverse);
    neighborSets[record.a]?.add(record.b);
    neighborSets[record.b]?.add(record.a);
  });

  const neighbors = neighborSets.map((set) => Uint32Array.from(set));
  return { neighbors, edges: edgeLists, triangleCount };
}
