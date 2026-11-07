import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function frontisVersion(): string {
  return (require('../../package.json') as { version: string }).version;
}

export function codePushUpPackage(): { name: string; version: string } {
  return require('@code-pushup/core/package.json') as { name: string; version: string };
}
