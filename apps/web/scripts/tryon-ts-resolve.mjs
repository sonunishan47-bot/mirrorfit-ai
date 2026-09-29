/**
 * Node loads the worker's TypeScript directly. Relative imports in those
 * files omit the `.ts` suffix because the app bundler adds it. This hook
 * only retries that suffix. It does not rewrite packages or invent code.
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const missing =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ERR_MODULE_NOT_FOUND';
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (missing && relative && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
