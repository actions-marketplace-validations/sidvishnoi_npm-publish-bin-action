import type { PlatformPackage } from "./generate-packages.ts";
import { env, run, sh } from "./utils.ts";

if (import.meta.main) {
	run(publishNpm, {
		packageName: env("PACKAGE_NAME"),
		version: env("VERSION"),
		mainDir: env("MAIN_DIR"),
		platformPackages: JSON.parse(env("PLATFORM_PACKAGES")),
		dryRun: env("DRY_RUN", "false") === "true",
		provenance: env("PROVENANCE", "false") === "true",
	});
}

export interface IPublishNpm {
	packageName: string;
	version: string;
	mainDir: string;
	platformPackages: PlatformPackage[];
	dryRun?: boolean;
	provenance?: boolean;
}

export function publishNpm({
	packageName,
	version,
	mainDir,
	platformPackages,
	dryRun = false,
	provenance = false,
}: IPublishNpm): void {
	const flags = [...(dryRun ? ["--dry-run"] : []), ...(provenance ? ["--provenance"] : [])];

	for (const { dir, name } of platformPackages) {
		console.log(`==> Publishing ${name}@${version}`);
		try {
			sh`npm publish --access public ${flags} ${dir}`;
		} catch (err) {
			if (!isAlreadyPublished(name, version)) throw err;
			console.warn(
				`==> skipping ${name}@${version}: already published (resuming a previously interrupted run)`,
			);
		}
	}

	console.log(`==> Publishing ${packageName}@${version}`);
	sh`npm publish --access public ${flags} ${mainDir}`;
}

function isAlreadyPublished(packageName: string, version: string): boolean {
	try {
		sh`npm view ${`${packageName}@${version}`} version`;
		return true;
	} catch {
		return false;
	}
}
