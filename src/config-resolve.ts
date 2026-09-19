import { mkdirSync } from "node:fs";
import path from "node:path";
import { appendGithubEnv, env, run } from "./utils.ts";

if (import.meta.main) {
	run(configResolve, {
		tag: env("TAG"),
		packageName: env("PACKAGE_NAME"),
		scope: env("SCOPE", ""),
		binName: env("BIN_NAME", ""),
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
	packageJsonTemplate,
	readme,
	licenseFile,
	runnerTemp,
}: IConfigResolve): void {
	const resolved = resolveConfig({ tag, packageName, scope, binName });

	const work = path.join(runnerTemp, "npm-publish");
	const dist = path.join(work, "dist");
	mkdirSync(dist, { recursive: true });

	appendGithubEnv({
		TAG: resolved.tag,
		VERSION: resolved.version,
		PACKAGE_NAME: resolved.packageName,
		SCOPE: resolved.scope,
		BIN_NAME: resolved.binName,
		PACKAGE_JSON_TEMPLATE: packageJsonTemplate,
		README: readme,
		LICENSE_FILE: licenseFile,
		WORK: work,
		DIST: dist,
	});
}

export type RawConfig = Pick<IConfigResolve, "tag" | "packageName" | "scope" | "binName">;

interface ResolvedConfig {
	tag: string;
	version: string;
	packageName: string;
	scope: string;
	binName: string;
}

export function resolveConfig(raw: RawConfig): ResolvedConfig {
	return {
		tag: raw.tag,
		version: raw.tag.replace(/^v/, ""),
		packageName: raw.packageName,
		scope: raw.scope || `@${raw.packageName}`,
		binName: raw.binName || raw.packageName,
	};
}
