import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Target } from "./discover-targets.ts";
import { appendGithubEnv, env, readJsonFile, run, sh, writeJsonFile } from "./utils.ts";

if (import.meta.main) {
	const templatePath = env("PACKAGE_JSON_TEMPLATE", "");
	const readmePath = env("README", "README.md");
	const licenseInput = env("LICENSE_FILE", "");

	const licensePath = path.resolve(licenseInput || "LICENSE");
	const hasLicense = licenseInput !== "" || fs.existsSync(licensePath);

	run(main, {
		packageName: env("PACKAGE_NAME"),
		scope: env("SCOPE"),
		binName: env("BIN_NAME"),
		version: env("VERSION"),
		work: env("WORK"),
		dist: env("DIST"),
		targets: JSON.parse(env("TARGETS")),
		packageJsonTemplate: templatePath
			? readJsonFile<PackageJsonTemplate>(path.resolve(templatePath))
			: {},
		readme: fs.readFileSync(path.resolve(readmePath), "utf8"),
		license: hasLicense ? fs.readFileSync(licensePath, "utf8") : null,
	});
}

function main(args: IGeneratePackages): void {
	const { mainDir, platformPackages } = generatePackages(args);

	appendGithubEnv({
		MAIN_DIR: mainDir,
		PLATFORM_PACKAGES: JSON.stringify(platformPackages),
	});
}

export interface IGeneratePackages {
	packageName: string;
	scope: string;
	binName: string;
	version: string;
	work: string;
	dist: string;
	targets: Target[];
	packageJsonTemplate: PackageJsonTemplate;
	readme: string;
	license: string | null;
}

export function generatePackages({
	packageName,
	scope,
	binName,
	version,
	work,
	dist,
	targets,
	packageJsonTemplate,
	readme,
	license,
}: IGeneratePackages): GenerateResult {
	const sharedFields = sharedTemplateFields(packageJsonTemplate);

	const platformPackageMap: Record<string, string[]> = {};
	const platformPackages: PlatformPackage[] = [];

	for (const target of targets) {
		const platformPackage = buildPlatformPackage({
			target,
			scope,
			packageName,
			binName,
			version,
			work,
			dist,
			sharedFields,
			license,
		});

		const key = `${target.os} ${target.cpu}`;
		platformPackageMap[key] ??= [];
		platformPackageMap[key].push(platformPackage.name);

		platformPackages.push(platformPackage);
	}

	const mainDir = path.join(work, "pkg", packageName);
	fs.mkdirSync(path.join(mainDir, "bin"), { recursive: true });

	const optionalDependencies = Object.fromEntries(
		platformPackages.map(({ name }) => [name, version]),
	);
	const mainPkg = buildMainPackageJson({
		packageName,
		version,
		binName,
		sharedFields,
		optionalDependencies,
	});
	writeJsonFile(path.join(mainDir, "package.json"), mainPkg);

	const wrapperSource = buildWrapperSource(binName, platformPackageMap);
	fs.writeFileSync(path.join(mainDir, "bin", binName), wrapperSource, { mode: 0o755 });

	fs.writeFileSync(path.join(mainDir, "README.md"), readme);
	if (license !== null) fs.writeFileSync(path.join(mainDir, "LICENSE"), license);

	console.log(
		"Prepared packages:",
		platformPackages
			.map((p) => p.name)
			.concat(packageName)
			.join(", "),
	);

	return { mainDir, platformPackages };
}

function buildPlatformPackage(params: {
	target: Target;
	scope: string;
	packageName: string;
	binName: string;
	version: string;
	work: string;
	dist: string;
	sharedFields: PackageJsonTemplate;
	license: string | null;
}): PlatformPackage {
	const { target, scope, packageName, binName, version, work, dist, sharedFields, license } =
		params;
	const { os, cpu, libc } = target;
	const pkgName = platformPackageName(scope, os, cpu, libc);

	const dir = path.join(work, "pkg", pkgName);
	const binDir = path.join(dir, "bin");
	fs.mkdirSync(binDir, { recursive: true });

	const archive = path.join(dist, target.filename);
	const exe = os === "win32" ? ".exe" : "";
	const member = `${binName}${exe}`;

	console.log(`==> extracting ${pkgName} from ${path.basename(archive)}`);
	extract(archive, member, binDir);

	const pkg = buildPlatformPackageJson({
		pkgName,
		version,
		os,
		cpu,
		libc,
		packageName,
		sharedFields,
	});
	writeJsonFile(path.join(dir, "package.json"), pkg);
	if (license !== null) fs.writeFileSync(path.join(dir, "LICENSE"), license);

	return { dir, name: pkgName };
}

export interface GenerateResult {
	mainDir: string;
	platformPackages: PlatformPackage[];
}

export interface PlatformPackage {
	dir: string;
	name: string;
}

export interface PackageJsonTemplate {
	[key: string]: unknown;
}

/**
 * Fields from the caller's template that should be copied into every
 * published package.json. Strips "name", "version", "bin", "files",
 * "optionalDependencies", "os", "cpu" and "libc" - those are always
 * computed by this action and must never come from the template.
 */
export function sharedTemplateFields(template: PackageJsonTemplate): PackageJsonTemplate {
	const { name, version, bin, files, optionalDependencies, os, cpu, libc, ...rest } = template;
	return rest;
}

export function platformPackageName(
	scope: string,
	os: string,
	cpu: string,
	libc: string | null,
): string {
	const platform = platformSlug(os, cpu, libc);
	return scope.startsWith("@") ? `${scope}/${platform}` : `${scope}-${platform}`;
}

function platformSlug(os: string, cpu: string, libc: string | null): string {
	return [os, cpu, libc].filter(Boolean).join("-");
}

function extract(archive: string, member: string, destDir: string): void {
	const tarFlags = tarFlagsFor(archive);
	if (tarFlags === null) {
		sh`unzip -oj ${archive} ${member} -d ${destDir}`;
	} else {
		sh`tar ${tarFlags} ${archive} -C ${destDir} ${member}`;
	}
}

export function tarFlagsFor(archiveFilename: string): string[] | null {
	const lower = archiveFilename.toLowerCase();
	if (lower.endsWith(".zip")) return null;
	if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) return ["-xJf"];
	if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) return ["-xjf"];
	if (lower.endsWith(".tar.zst") || lower.endsWith(".tzst")) return ["--zstd", "-xf"];
	return ["-xzf"];
}

export function buildPlatformPackageJson(params: {
	pkgName: string;
	version: string;
	os: string;
	cpu: string;
	libc: string | null;
	packageName: string;
	sharedFields: PackageJsonTemplate;
}): Record<string, unknown> {
	const { pkgName, version, os, cpu, libc, packageName, sharedFields } = params;
	const platform = platformSlug(os, cpu, libc);
	const baseDescription = `The ${platform} binary for ${packageName}.`;
	const description = sharedFields.description
		? `${baseDescription} ${sharedFields.description}`
		: baseDescription;

	return {
		name: pkgName,
		version,
		...sharedFields,
		description,
		os: [os],
		cpu: [cpu],
		...(libc ? { libc: [libc] } : {}),
	};
}

export function buildMainPackageJson(params: {
	packageName: string;
	version: string;
	binName: string;
	sharedFields: PackageJsonTemplate;
	optionalDependencies: Record<string, string>;
}): Record<string, unknown> {
	const { packageName, version, binName, sharedFields, optionalDependencies } = params;
	return {
		name: packageName,
		version,
		...sharedFields,
		bin: { [binName]: `bin/${binName}` },
		files: ["bin"],
		optionalDependencies,
	};
}

const WRAPPER_TEMPLATE_PATH = fileURLToPath(new URL("./wrapper-template.txt", import.meta.url));

export function buildWrapperSource(
	binName: string,
	platformPackages: Record<string, string[]>,
): string {
	const template = fs.readFileSync(WRAPPER_TEMPLATE_PATH, "utf8");
	const packagesJson = JSON.stringify(platformPackages, null, 2);

	return template
		.replaceAll("__PACKAGES_JSON__", () => packagesJson)
		.replaceAll("__BIN_NAME__", () => binName);
}
