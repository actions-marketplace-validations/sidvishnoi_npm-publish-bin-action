import type { PlatformPackage } from "./generate-packages.ts";
import { env, run, sh, withGroup } from "./utils.ts";

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
	const entries = [...platformPackages, { dir: mainDir, name: packageName }];
	const total = entries.length;

	if (dryRun) console.log("::notice::DRY RUN — no packages will actually be published");

	const results: Array<{ name: string; status: "published" | "skipped" }> = [];

	entries.forEach(({ dir, name }, i) => {
		const label = `[${i + 1}/${total}]`;
		console.log(`${label} Publishing ${name}@${version}`);
		try {
			sh`npm publish --access public ${flags} ${dir}`;
			results.push({ name, status: "published" });
		} catch (err) {
			if (!isAlreadyPublished(name, version)) throw err;
			console.warn(
				`${label} skipping ${name}@${version}: already published (resuming a previously interrupted run)`,
			);
			results.push({ name, status: "skipped" });
		}
		console.log("");
	});

	withGroup(`Publish summary (${total})`, () => {
		for (const { name, status } of results) {
			console.log(`- ${name}@${version}: ${status}`);
		}
	});
}

function isAlreadyPublished(packageName: string, version: string): boolean {
	try {
		sh`npm view ${`${packageName}@${version}`} version`;
		return true;
	} catch {
		return false;
	}
}
