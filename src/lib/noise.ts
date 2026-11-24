// 确定性二维值噪声(不依赖随机种子,保证地形可复现)

function hash2(ix: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);

  const h00 = hash2(ix, iz);
  const h10 = hash2(ix + 1, iz);
  const h01 = hash2(ix, iz + 1);
  const h11 = hash2(ix + 1, iz + 1);

  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz); // 0..1
}

/** 多频叠加噪声,返回约 -1..1 */
export function fbm(x: number, z: number): number {
  return (
    (valueNoise(x, z) - 0.5) * 0.9 +
    (valueNoise(x * 2.7 + 11.3, z * 2.7 - 7.1) - 0.5) * 0.45 +
    (valueNoise(x * 6.1 - 4.7, z * 6.1 + 9.2) - 0.5) * 0.2
  );
}
