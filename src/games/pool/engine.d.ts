/** Mounts the 3D pool game into `host` (inside a shadow root) and returns a cleanup function. */
export function mountPool(host: HTMLElement, opts: { onExit: () => void }): () => void;
