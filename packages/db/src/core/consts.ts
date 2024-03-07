import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PACKAGE_NAME = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).name;

export const RUNTIME_IMPORT = JSON.stringify(`${PACKAGE_NAME}/runtime`);
export const RUNTIME_CONFIG_IMPORT = JSON.stringify(`${PACKAGE_NAME}/runtime/config`);

export const DB_TYPES_FILE = 'db-types.d.ts';

export const VIRTUAL_MODULE_ID = 'astro:db';

export const DB_PATH = `.astro/${
	process.env.ASTRO_TEST_RANDOM_DB_ID ? randomUUID() : 'content.db'
}`;

export const CONFIG_FILE_NAMES = ['config.ts', 'config.js', 'config.mts', 'config.mjs'];
