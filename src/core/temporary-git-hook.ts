import type { ResolveHook } from 'node:module';

export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
  const resolved = await nextResolve(specifier, context);
  if (specifier !== 'simple-git' || !context.parentURL?.includes('/node_modules/@code-pushup/utils/')) {
    return resolved;
  }

  // Code PushUp вызывает simpleGit без настроек. Для временного Git разрешаем только два пути.
  const moduleUrl = JSON.stringify(resolved.url);
  const source = `
    export * from ${moduleUrl};
    import { simpleGit as createGit } from ${moduleUrl};

    export function simpleGit(baseDir, options) {
      return createGit(baseDir, { ...options, allowEnvironment: ['GIT_DIR', 'GIT_WORK_TREE'] });
    }
  `;
  return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
};
