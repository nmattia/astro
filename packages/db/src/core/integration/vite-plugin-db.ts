import { fileURLToPath } from 'node:url';
import { normalizePath } from 'vite';
import { SEED_DEV_FILE_NAME, recreateTables } from '../../runtime/queries.js';
import { DB_PATH, RUNTIME_CONFIG_IMPORT, RUNTIME_IMPORT, VIRTUAL_MODULE_ID } from '../consts.js';
import type { DBTables } from '../types.js';
import { type VitePlugin, getDbDirectoryUrl, getRemoteDatabaseUrl } from '../utils.js';
import { createLocalDatabaseClient } from '../../runtime/db-client.js';

const LOCAL_DB_VIRTUAL_MODULE_ID = 'astro:local';
const WITH_SEED_VIRTUAL_MODULE_ID = 'astro:db:seed';

const resolved = {
	localDb: '\0' + LOCAL_DB_VIRTUAL_MODULE_ID,
	virtual: '\0' + VIRTUAL_MODULE_ID,
	seedVirtual: '\0' + WITH_SEED_VIRTUAL_MODULE_ID,
};

export type LateTables = {
	get: () => DBTables;
};

type VitePluginDBParams =
	| {
			connectToStudio: false;
			tables: LateTables;
			srcDir: URL;
			root: URL;
	  }
	| {
			connectToStudio: true;
			tables: LateTables;
			appToken: string;
			srcDir: URL;
			root: URL;
	  };

export function vitePluginDb(params: VitePluginDBParams): VitePlugin {
	const srcDirPath = normalizePath(fileURLToPath(params.srcDir));
	const seedFilePaths = SEED_DEV_FILE_NAME.map((name) =>
		normalizePath(fileURLToPath(new URL(name, getDbDirectoryUrl(params.root))))
	);
	return {
		name: 'astro:db',
		enforce: 'pre',
		async resolveId(id, rawImporter) {
			if (id === LOCAL_DB_VIRTUAL_MODULE_ID) return resolved.localDb;
			if (id !== VIRTUAL_MODULE_ID) return;
			if (params.connectToStudio) return resolved.virtual;

			const importer = rawImporter ? await this.resolve(rawImporter) : null;
			if (!importer) return resolved.virtual;

			if (importer.id.startsWith(srcDirPath)) {
				// Seed only if the importer is in the src directory.
				// Otherwise, we may get recursive seed calls (ex. import from db/seed.ts).
				return resolved.seedVirtual;
			}
			return resolved.virtual;
		},
		async load(id) {
			if (id === resolved.localDb) {
				const dbUrl = new URL(DB_PATH, params.root);
				return `import { createLocalDatabaseClient } from ${RUNTIME_IMPORT};
				const dbUrl = ${JSON.stringify(dbUrl)};

				export const db = createLocalDatabaseClient({ dbUrl });`;
			}

			// Recreate tables whenever a seed file is loaded.
			if (seedFilePaths.some((f) => id === f)) {
				await recreateTables({
					db: createLocalDatabaseClient({ dbUrl: new URL(DB_PATH, params.root).href }),
					tables: params.tables.get(),
				});
			}

			if (id !== resolved.virtual && id !== resolved.seedVirtual) return;

			if (params.connectToStudio) {
				return getStudioVirtualModContents({
					appToken: params.appToken,
					tables: params.tables.get(),
				});
			}
			return getLocalVirtualModContents({
				root: params.root,
				tables: params.tables.get(),
				shouldSeed: id === resolved.seedVirtual,
			});
		},
	};
}

export function getConfigVirtualModContents() {
	return `export * from ${RUNTIME_CONFIG_IMPORT}`;
}

export function getLocalVirtualModContents({
	tables,
	shouldSeed,
}: {
	tables: DBTables;
	root: URL;
	shouldSeed: boolean;
}) {
	const seedFilePaths = SEED_DEV_FILE_NAME.map(
		// Format as /db/[name].ts
		// for Vite import.meta.glob
		(name) => new URL(name, getDbDirectoryUrl('file:///')).pathname
	);

	return `
import { asDrizzleTable } from ${RUNTIME_IMPORT};
import { db as _db } from ${JSON.stringify(LOCAL_DB_VIRTUAL_MODULE_ID)};

export const db = _db;

${shouldSeed ? `import.meta.glob(${JSON.stringify(seedFilePaths)}, { eager: true });` : ''}

export * from ${RUNTIME_CONFIG_IMPORT};

${getStringifiedCollectionExports(tables)}`;
}

export function getStudioVirtualModContents({
	tables,
	appToken,
}: {
	tables: DBTables;
	appToken: string;
}) {
	return `
import {asDrizzleTable, createRemoteDatabaseClient} from ${RUNTIME_IMPORT};

export const db = await createRemoteDatabaseClient(${JSON.stringify(
		appToken
		// Respect runtime env for user overrides in SSR
	)}, import.meta.env.ASTRO_STUDIO_REMOTE_DB_URL ?? ${JSON.stringify(getRemoteDatabaseUrl())});

export * from ${RUNTIME_CONFIG_IMPORT};

${getStringifiedCollectionExports(tables)}
	`;
}

function getStringifiedCollectionExports(tables: DBTables) {
	return Object.entries(tables)
		.map(
			([name, collection]) =>
				`export const ${name} = asDrizzleTable(${JSON.stringify(name)}, ${JSON.stringify(
					collection
				)}, false)`
		)
		.join('\n');
}
