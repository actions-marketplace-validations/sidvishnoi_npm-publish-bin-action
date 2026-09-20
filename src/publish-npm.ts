import type { PlatformPackage } from "./generate-packages.ts";
import { appendStepSummary, env, run, sh, withGroup } from "./utils.ts";

if (import.meta.main) {
	run(main, {
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

function main(args: IPublishNpm): void {
	const { packageName, version, dryRun = false } = args;
	const total = args.platformPackages.length + 1;
	const results: PublishResult[] = [];

	try {
		publishNpm(args, results);
	} finally {
		writeSummary({ packageName, version, dryRun, total, results });
	}
}

export function publishNpm(
	{
		packageName,
		version,
		mainDir,
		platformPackages,
		dryRun = false,
		provenance = false,
	}: IPublishNpm,
	results: PublishResult[] = [],
): void {
	const flags = [...(dryRun ? ["--dry-run"] : []), ...(provenance ? ["--provenance"] : [])];
	const entries = [...platformPackages, { dir: mainDir, name: packageName }];
	const total = entries.length;

	if (dryRun) console.log("::notice::DRY RUN — no packages will actually be published");

	entries.forEach(({ dir, name }, i) => {
		const isMain = i === entries.length - 1;
		const label = `[${i + 1}/${total}]`;
		console.log(`${label} Publishing ${name}@${version}`);
		try {
			const output = sh`npm publish --access public ${flags} ${dir}`;
			const size = parsePackageSize(output);
			results.push({ name, status: "published", isMain, ...(size ? { size } : {}) });
		} catch (err) {
			if (!isAlreadyPublished(name, version)) throw err;
			console.warn(
				`${label} skipping ${name}@${version}: already published (resuming a previously interrupted run)`,
			);
			results.push({ name, status: "skipped", isMain });
		}
		console.log("");
	});
}

// -------------------------
// #region Summary

interface PublishResult {
	name: string;
	status: "published" | "skipped";
	isMain: boolean;
	size?: ReturnType<typeof parsePackageSize>;
}

function writeSummary(params: {
	packageName: string;
	version: string;
	dryRun: boolean;
	total: number;
	results: PublishResult[];
}): void {
	const { packageName, version, dryRun, total, results } = params;
	const incomplete = results.length < total;

	withGroup(`Publish summary (${results.length}/${total})`, () => {
		for (const { name, status } of results) {
			console.log(`- ${name}@${version}: ${status}`);
		}
	});

	appendStepSummary(buildStepSummary({ packageName, version, dryRun, incomplete, results }));
}

function buildStepSummary(params: {
	packageName: string;
	version: string;
	dryRun: boolean;
	incomplete: boolean;
	results: PublishResult[];
}): string {
	const { packageName, version, dryRun, incomplete, results } = params;

	const lines = [
		`### Published \`${packageName}@${version}\`${dryRun ? " (dry run)" : ""}${incomplete ? " ⚠️ incomplete" : ""}`,
		"",
	];

	const main = results.find((r) => r.isMain);
	if (main) {
		const nameLabel = dryRun
			? `\`${main.name}\``
			: `[\`${main.name}\`](${npmPackageUrl(main, version)})`;
		lines.push(`${nameLabel}${sizeSuffix(main.size)}${skippedSuffix(main.status)}`, "");
	}

	const platform = results.filter((r) => !r.isMain);
	if (platform.length > 0) {
		lines.push("Platform packages:", "");
		for (const p of platform) {
			lines.push(`- \`${p.name}\`${sizeSuffix(p.size)}${skippedSuffix(p.status)}`);
		}
	}

	return lines.join("\n");

	function sizeSuffix(size: ReturnType<typeof parsePackageSize>): string {
		return size ? ` (${size.packed} packed, ${size.unpacked} unpacked)` : "";
	}
	function skippedSuffix(status: PublishResult["status"]): string {
		return status === "skipped" ? " [SKIPPED]" : "";
	}
	function npmPackageUrl(pkg: { name: string }, version: string): string {
		return `https://www.npmjs.com/package/${pkg.name}/v/${version}`;
	}
}

function parsePackageSize(npmOutput: string) {
	const packed = /npm notice package size:\s*(.+)/.exec(npmOutput)?.[1]?.trim();
	const unpacked = /npm notice unpacked size:\s*(.+)/.exec(npmOutput)?.[1]?.trim();
	return packed && unpacked ? { packed, unpacked } : undefined;
}

function isAlreadyPublished(packageName: string, version: string): boolean {
	try {
		sh`npm view ${`${packageName}@${version}`} version`;
		return true;
	} catch {
		return false;
	}
}
