import { createSignal } from 'solid-js';

const [collisionNonce, setCollisionNonce] = createSignal(0);

export function collisionRunNonce() {
  return collisionNonce();
}

export function requestCollisionRun() {
  setCollisionNonce((n) => n + 1);
}
