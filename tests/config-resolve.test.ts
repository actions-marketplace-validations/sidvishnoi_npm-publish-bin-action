import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { expect } from "chai";
import {
	configResolve,
	type IConfigResolve,
	type RawConfig,
	resolveConfig,
} from "#src/config-resolve.ts";
import { tmpDir } from "./helpers.ts";

describe("resolveConfig", () => {
	const base: RawConfig = { tag: "v1.2.3", packageName: "mytool", scope: "", binName: "" };

	describe("version", () => {
		test("strips a leading v from the tag", () => {
			expect(resolveConfig(base).version).to.equal("1.2.3");
		});

		test("keeps a tag with no leading v as-is", () => {
			expect(resolveConfig({ ...base, tag: "1.2.3" }).version).to.equal("1.2.3");
		});
	});

	describe("scope", () => {
		test("defaults to @packageName", () => {
			expect(resolveConfig(base).scope).to.equal("@mytool");
		});

		test("respects an explicit scope", () => {
			expect(resolveConfig({ ...base, scope: "@custom" }).scope).to.equal("@custom");
		});

		test("accepts an unscoped prefix as-is", () => {
			expect(resolveConfig({ ...base, scope: "custom" }).scope).to.equal("custom");
		});

		test("strips a trailing dash from an unscoped prefix", () => {
			expect(resolveConfig({ ...base, scope: "custom-" }).scope).to.equal("custom");
			expect(resolveConfig({ ...base, scope: "custom---" }).scope).to.equal("custom");
		});

		test("does not strip a trailing dash from a scoped prefix", () => {
			expect(resolveConfig({ ...base, scope: "@custom-" }).scope).to.equal("@custom-");
		});
	});

	describe("binName", () => {
		test("defaults to packageName", () => {
			expect(resolveConfig(base).binName).to.equal("mytool");
		});

		test("respects an explicit binName", () => {
			expect(resolveConfig({ ...base, binName: "wc" }).binName).to.equal("wc");
		});
	});

	test("passes packageName through unchanged", () => {
		expect(resolveConfig(base).packageName).to.equal("mytool");
	});
});

describe("configResolve", () => {
	test("resolves defaults, creates the dist dir, and appends GITHUB_ENV", () => {
		const runnerTemp = tmpDir();
		const vars = run({ runnerTemp });

		const work = path.join(runnerTemp, "npm-publish");
		const dist = path.join(work, "dist");
		expect(fs.existsSync(dist)).to.be.true;

		expect(vars.TAG).to.equal("v1.2.3");
		expect(vars.VERSION).to.equal("1.2.3");
		expect(vars.PACKAGE_NAME).to.equal("mytool");
		expect(vars.SCOPE).to.equal("@mytool");
		expect(vars.BIN_NAME).to.equal("mytool");
		expect(vars.PACKAGE_JSON_TEMPLATE).to.equal("npm/package.json");
		expect(vars.README).to.equal("");
		expect(vars.LICENSE_FILE).to.equal("");
		expect(vars.WORK).to.equal(work);
		expect(vars.DIST).to.equal(dist);
	});

	test("respects an explicit scope and bin-name", () => {
		const vars = run({ tag: "1.0.0", scope: "@custom", binName: "wc", packageJsonTemplate: "" });
		expect(vars.VERSION).to.equal("1.0.0");
		expect(vars.SCOPE).to.equal("@custom");
		expect(vars.BIN_NAME).to.equal("wc");
		expect(vars.PACKAGE_JSON_TEMPLATE).to.equal("");
	});

	test("passes readme and license-file paths through unchanged", () => {
		const vars = run({ readme: "docs/README.md", licenseFile: "LICENSE.txt" });
		expect(vars.README).to.equal("docs/README.md");
		expect(vars.LICENSE_FILE).to.equal("LICENSE.txt");
	});
});

function parseGithubEnv(filePath: string): Record<string, string> {
	const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
	return Object.fromEntries(
		lines.map((line) => {
			const i = line.indexOf("=");
			return [line.slice(0, i), line.slice(i + 1)];
		}),
	);
}

function run(overrides: Partial<IConfigResolve> = {}): Record<string, string> {
	const runnerTemp = tmpDir();
	const githubEnv = path.join(runnerTemp, "github_env");
	fs.writeFileSync(githubEnv, "");
	process.env.GITHUB_ENV = githubEnv;

	configResolve({
		tag: "v1.2.3",
		packageName: "mytool",
		scope: "",
		binName: "",
		packageJsonTemplate: "npm/package.json",
		readme: "",
		licenseFile: "",
		runnerTemp,
		...overrides,
	});

	delete process.env.GITHUB_ENV;
	return parseGithubEnv(githubEnv);
}
