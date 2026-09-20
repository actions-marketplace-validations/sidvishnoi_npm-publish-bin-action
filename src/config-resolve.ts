import { mkdirSync } from "node:fs";
import path from "node:path";
import { appendGithubEnv, env, run, withGroup } from "./utils.ts";

if (import.meta.main) {
	run(configResolve, {
		tag: env("TAG"),
		packageName: env("PACKAGE_NAME"),
		scope: env("SCOPE", ""),
		binName: env("BIN_NAME", ""),
		mode: env("MODE", ""),
		packageJsonTemplate: env("PACKAGE_JSON_TEMPLATE", ""),
		readme: env("README", ""),
		licenseFile: env("LICENSE_FILE", ""),
		runnerTemp: env("RUNNER_TEMP"),
	});
}

export interface IConfigResolve {
	tag: string;
	packageName: string;
	scope: string;
	binName: string;
	mode: string;
	packageJsonTemplate: string;
	readme: string;
	licenseFile: string;
	runnerTemp: string;
}

export function configResolve({
	tag,
	packageName,
	scope,
	binName,
	mode,
	packageJsonTemplate,
	readme,
	licenseFile,
	runnerTemp,
}: IConfigResolve): void {
	const resolved = resolveConfig({ tag, packageName, scope, binName, mode });

	withGroup("Resolved configuration", () => {
		console.log(`package: ${resolved.packageName}`);
		console.log(`scope: ${resolved.scope}`);
		console.log(`bin: ${resolved.binName}`);
		console.log(`version: ${resolved.version} (tag ${resolved.tag})`);
		console.log(`mode: ${resolved.mode}`);
	});

	const work = path.join(runnerTemp, "npm-publish");
	const dist = path.join(work, "dist");
	mkdirSync(dist, { recursive: true });

	appendGithubEnv({
		TAG: resolved.tag,
		VERSION: resolved.version,
		PACKAGE_NAME: resolved.packageName,
		SCOPE: resolved.scope,
		BIN_NAME: resolved.binName,
		MODE: resolved.mode,
		PACKAGE_JSON_TEMPLATE: packageJsonTemplate,
		README: readme,
		LICENSE_FILE: licenseFile,
		WORK: work,
		DIST: dist,
	});
}

export type RawConfig = Pick<IConfigResolve, "tag" | "packageName" | "scope" | "binName" | "mode">;

interface ResolvedConfig {
	tag: string;
	version: string;
	packageName: string;
	scope: string;
	binName: string;
	mode: "multi" | "single";
}

export function resolveConfig(raw: RawConfig): ResolvedConfig {
	return {
		tag: raw.tag,
		version: raw.tag.replace(/^v/, ""),
		packageName: raw.packageName,
		scope: normalizeScope(raw.scope, raw.packageName),
		binName: raw.binName || raw.packageName,
		mode: normalizeMode(raw.mode),
	};
}

function normalizeMode(mode: string): "multi" | "single" {
	const value = mode || "multi";
	if (value !== "multi" && value !== "single") {
		throw new Error(`Invalid mode "${value}": expected "multi" or "single".`);
	}
	return value;
}

function normalizeScope(scope: string, packageName: string): string {
	scope ||= `@${packageName}`;
	return scope.startsWith("@") ? scope : scope.replace(/-+$/, "");
}
