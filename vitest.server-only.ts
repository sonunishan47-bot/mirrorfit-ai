/**
 * Stands in for the `server-only` package during tests.
 *
 * `server-only` works by exporting a module that throws on import, and
 * relying on Next's `react-server` condition to swap in an empty one when the
 * import really is on the server. Vitest has no client/server module graph,
 * so it always picks the throwing one and any module with that guard fails to
 * load.
 *
 * Aliasing it here keeps the guard doing its real job — failing the `next
 * build` if server-only code is pulled into a client bundle — while letting
 * those same modules be unit tested.
 */
export {};
