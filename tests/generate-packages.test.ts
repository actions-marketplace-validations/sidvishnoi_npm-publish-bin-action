import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { expect } from "chai";
import {
	buildMainPackageJson,
	buildPlatformPackageJson,
	buildWrapperSource,
	generatePackages,
	type IGeneratePackages,
	platformPackageName,
	sharedTemplateFields,
	tarFlagsFor,
} from "#src/generate-packages.ts";
import { captureOutput, tmpDir } from "./helpers.ts";

describe("sharedTemplateFields", () => {
	test("strips computed fields, keeps the rest", () => {
		const result = sharedTemplateFields({
			name: "should-be-dropped",
			version: "0.0.0",
			bin: { x: "y" },
			files: ["bin"],
			optionalDependencies: { a: "1" },
			os: ["linux"],
			cpu: ["x64"],
			description: "A tool",
			license: "MIT",
			repository: "github:foo/bar",
		});
		expect(result).to.deep.equal({
			description: "A tool",
			license: "MIT",
			repository: "github:foo/bar",
		});
	});
});

describe("platformPackageName", () => {
	test("joins an npm scope with a slash", () => {
		expect(platformPackageName("@mytool", "darwin", "arm64", null)).to.equal(
			"@mytool/darwin-arm64",
		);
	});

	test("joins an unscoped prefix with a dash", () => {
		expect(platformPackageName("mytool", "darwin", "arm64", null)).to.equal("mytool-darwin-arm64");
	});

	test("appends the libc variant when given", () => {
		expect(platformPackageName("@mytool", "linux", "x64", "musl")).to.equal(
			"@mytool/linux-x64-musl",
		);
	});
});

describe("buildPlatformPackageJson", () => {
	const base = {
		pkgName: "@mytool/darwin-arm64",
		version: "1.2.3",
		os: "darwin",
		cpu: "arm64",
		libc: null as string | null,
		packageName: "mytool",
		sharedFields: {},
	};

	test("prefixes the platform description onto the template's", () => {
		const pkg = buildPlatformPackageJson({
			...base,
			sharedFields: { description: "Walks content dirs.", license: "MIT" },
		});
		expect(pkg.name).to.equal("@mytool/darwin-arm64");
		expect(pkg.description).to.equal("The darwin-arm64 binary for mytool. Walks content dirs.");
		expect(pkg.license).to.equal("MIT");
		expect(pkg.os).to.deep.equal(["darwin"]);
		expect(pkg.cpu).to.deep.equal(["arm64"]);
		expect(pkg.libc).to.be.undefined;
	});

	test("works with no template description", () => {
		const pkg = buildPlatformPackageJson({
			...base,
			pkgName: "mytool-linux-x64",
			os: "linux",
			cpu: "x64",
		});
		expect(pkg.description).to.equal("The linux-x64 binary for mytool.");
	});

	test("includes a libc field, and mentions it in the description, when libc is given", () => {
		const pkg = buildPlatformPackageJson({
			...base,
			pkgName: "@mytool/linux-x64-musl",
			os: "linux",
			cpu: "x64",
			libc: "musl",
		});
		expect(pkg.description).to.equal("The linux-x64-musl binary for mytool.");
		expect(pkg.libc).to.deep.equal(["musl"]);
	});
});

describe("buildMainPackageJson", () => {
	test("computes bin/files/optionalDependencies, keeps shared fields", () => {
		const pkg = buildMainPackageJson({
			packageName: "mytool",
			version: "1.2.3",
			binName: "mytool",
			sharedFields: { license: "MIT", description: "desc" },
			optionalDependencies: { "@mytool/darwin-arm64": "1.2.3" },
		});
		expect(pkg.name).to.equal("mytool");
		expect(pkg.bin).to.deep.equal({ mytool: "bin/mytool" });
		expect(pkg.files).to.deep.equal(["bin"]);
		expect(pkg.optionalDependencies).to.deep.equal({ "@mytool/darwin-arm64": "1.2.3" });
		expect(pkg.license).to.equal("MIT");
	});
});

describe("buildWrapperSource", () => {
	test("embeds the platform map (candidates per os/cpu) and is valid JS", () => {
		const source = buildWrapperSource("mytool", {
			"darwin arm64": ["@mytool/darwin-arm64"],
			"linux x64": ["@mytool/linux-x64-gnu", "@mytool/linux-x64-musl"],
		});
		expect(source).to.match(/@mytool\/darwin-arm64/);
		expect(source).to.match(/@mytool\/linux-x64-gnu/);
		expect(source).to.match(/@mytool\/linux-x64-musl/);
		expect(source).to.match(/mytool: unsupported platform/);
		new Function(source.replace(/^#!.*\n/, ""));
	});
});

describe("tarFlagsFor", () => {
	test("picks flags by extension, null for zip", () => {
		expect(tarFlagsFor("foo.zip")).to.be.null;
		expect(tarFlagsFor("foo.tar.gz")).to.deep.equal(["-xzf"]);
		expect(tarFlagsFor("foo.tar.xz")).to.deep.equal(["-xJf"]);
		expect(tarFlagsFor("foo.tar.bz2")).to.deep.equal(["-xjf"]);
		expect(tarFlagsFor("foo.tar.zst")).to.deep.equal(["--zstd", "-xf"]);
	});
});

function makeArchive(dist: string, filename: string, binName: string): void {
	const srcDir = tmpDir();
	fs.writeFileSync(path.join(srcDir, binName), "#!/bin/sh\necho hi\n", { mode: 0o755 });
	execFileSync("tar", ["-czf", path.join(dist, filename), "-C", srcDir, binName]);
}

describe("generatePackages", () => {
	const base: Omit<IGeneratePackages, "work" | "dist" | "targets" | "packageJsonTemplate"> = {
		packageName: "mytool",
		scope: "@mytool",
		binName: "mytool",
		version: "1.0.0",
		readme: "# mytool\n",
		license: null,
	};

	test("extracts binaries and writes platform + main package manifests", () => {
		const work = tmpDir();
		const dist = path.join(work, "dist");
		fs.mkdirSync(dist, { recursive: true });
		makeArchive(dist, "mytool_1.0.0_linux_amd64.tar.gz", "mytool");
		makeArchive(dist, "mytool_1.0.0_darwin_arm64.tar.gz", "mytool");

		const targets = [
			{ filename: "mytool_1.0.0_linux_amd64.tar.gz", os: "linux", cpu: "x64", libc: null },
			{ filename: "mytool_1.0.0_darwin_arm64.tar.gz", os: "darwin", cpu: "arm64", libc: null },
		];

		const { result } = captureOutput(() =>
			generatePackages({ ...base, work, dist, targets, packageJsonTemplate: {} }),
		);

		const linuxDir = path.join(work, "pkg", "@mytool", "linux-x64");
		const linuxPkg = JSON.parse(fs.readFileSync(path.join(linuxDir, "package.json"), "utf8"));
		expect(linuxPkg.name).to.equal("@mytool/linux-x64");
		expect(linuxPkg.os).to.deep.equal(["linux"]);
		expect(linuxPkg.cpu).to.deep.equal(["x64"]);
		expect(fs.existsSync(path.join(linuxDir, "bin", "mytool"))).to.be.true;

		const mainDir = path.join(work, "pkg", "mytool");
		const mainPkg = JSON.parse(fs.readFileSync(path.join(mainDir, "package.json"), "utf8"));
		expect(mainPkg.name).to.equal("mytool");
		expect(mainPkg.optionalDependencies).to.deep.equal({
			"@mytool/linux-x64": "1.0.0",
			"@mytool/darwin-arm64": "1.0.0",
		});
		expect(mainPkg.bin).to.deep.equal({ mytool: "bin/mytool" });
		expect(fs.existsSync(path.join(mainDir, "bin", "mytool"))).to.be.true;

		expect(result.mainDir).to.equal(mainDir);
		expect(result.platformPackages).to.deep.equal([
			{ dir: linuxDir, name: "@mytool/linux-x64" },
			{ dir: path.join(work, "pkg", "@mytool", "darwin-arm64"), name: "@mytool/darwin-arm64" },
		]);
	});

	test("extracts a .exe from a zip for windows targets", () => {
		const work = tmpDir();
		const dist = path.join(work, "dist");
		fs.mkdirSync(dist, { recursive: true });

		const srcDir = tmpDir();
		fs.writeFileSync(path.join(srcDir, "mytool.exe"), "not a real exe");
		execFileSync("zip", [
			"-j",
			path.join(dist, "mytool_1.0.0_windows_amd64.zip"),
			path.join(srcDir, "mytool.exe"),
		]);

		const targets = [
			{ filename: "mytool_1.0.0_windows_amd64.zip", os: "win32", cpu: "x64", libc: null },
		];

		captureOutput(() =>
			generatePackages({ ...base, work, dist, targets, packageJsonTemplate: {} }),
		);

		const winDir = path.join(work, "pkg", "@mytool", "win32-x64");
		expect(fs.existsSync(path.join(winDir, "bin", "mytool.exe"))).to.be.true;
	});

	test("merges fields from a package.json template", () => {
		const work = tmpDir();
		const dist = path.join(work, "dist");
		fs.mkdirSync(dist, { recursive: true });
		makeArchive(dist, "mytool_1.0.0_linux_amd64.tar.gz", "mytool");

		const targets = [
			{ filename: "mytool_1.0.0_linux_amd64.tar.gz", os: "linux", cpu: "x64", libc: null },
		];

		captureOutput(() =>
			generatePackages({
				...base,
				work,
				dist,
				targets,
				packageJsonTemplate: { license: "MIT", description: "A generic tool." },
			}),
		);

		const linuxPkg = JSON.parse(
			fs.readFileSync(path.join(work, "pkg", "@mytool", "linux-x64", "package.json"), "utf8"),
		);
		expect(linuxPkg.license).to.equal("MIT");
		expect(linuxPkg.description).to.equal("The linux-x64 binary for mytool. A generic tool.");

		const mainPkg = JSON.parse(
			fs.readFileSync(path.join(work, "pkg", "mytool", "package.json"), "utf8"),
		);
		expect(mainPkg.license).to.equal("MIT");
	});

	test("keeps glibc and musl builds of the same os/cpu as separate packages", () => {
		const work = tmpDir();
		const dist = path.join(work, "dist");
		fs.mkdirSync(dist, { recursive: true });
		makeArchive(dist, "mytool-x86_64-unknown-linux-gnu.tar.gz", "mytool");
		makeArchive(dist, "mytool-x86_64-unknown-linux-musl.tar.gz", "mytool");

		const targets = [
			{
				filename: "mytool-x86_64-unknown-linux-gnu.tar.gz",
				os: "linux",
				cpu: "x64",
				libc: "glibc",
			},
			{
				filename: "mytool-x86_64-unknown-linux-musl.tar.gz",
				os: "linux",
				cpu: "x64",
				libc: "musl",
			},
		];

		const { result } = captureOutput(() =>
			generatePackages({ ...base, work, dist, targets, packageJsonTemplate: {} }),
		);

		expect(result.platformPackages.map((p) => p.name)).to.deep.equal([
			"@mytool/linux-x64-glibc",
			"@mytool/linux-x64-musl",
		]);

		const gnuPkg = JSON.parse(
			fs.readFileSync(path.join(work, "pkg", "@mytool", "linux-x64-glibc", "package.json"), "utf8"),
		);
		expect(gnuPkg.libc).to.deep.equal(["glibc"]);
		const muslPkg = JSON.parse(
			fs.readFileSync(path.join(work, "pkg", "@mytool", "linux-x64-musl", "package.json"), "utf8"),
		);
		expect(muslPkg.libc).to.deep.equal(["musl"]);

		const mainPkg = JSON.parse(
			fs.readFileSync(path.join(work, "pkg", "mytool", "package.json"), "utf8"),
		);
		expect(mainPkg.optionalDependencies).to.deep.equal({
			"@mytool/linux-x64-glibc": "1.0.0",
			"@mytool/linux-x64-musl": "1.0.0",
		});

		const wrapperSource = fs.readFileSync(
			path.join(work, "pkg", "mytool", "bin", "mytool"),
			"utf8",
		);
		expect(wrapperSource).to.match(/@mytool\/linux-x64-glibc/);
		expect(wrapperSource).to.match(/@mytool\/linux-x64-musl/);
	});

	test("writes README to the main package only, and LICENSE to every package when given", () => {
		const work = tmpDir();
		const dist = path.join(work, "dist");
		fs.mkdirSync(dist, { recursive: true });
		makeArchive(dist, "mytool_1.0.0_linux_amd64.tar.gz", "mytool");

		const targets = [
			{ filename: "mytool_1.0.0_linux_amd64.tar.gz", os: "linux", cpu: "x64", libc: null },
		];

		captureOutput(() =>
			generatePackages({
				...base,
				work,
				dist,
				targets,
				packageJsonTemplate: {},
				readme: "# hello\n",
				license: "MIT License text\n",
			}),
		);

		const mainDir = path.join(work, "pkg", "mytool");
		const linuxDir = path.join(work, "pkg", "@mytool", "linux-x64");

		expect(fs.readFileSync(path.join(mainDir, "README.md"), "utf8")).to.equal("# hello\n");
		expect(fs.readFileSync(path.join(mainDir, "LICENSE"), "utf8")).to.equal("MIT License text\n");

		expect(fs.existsSync(path.join(linuxDir, "README.md"))).to.be.false;
		expect(fs.readFileSync(path.join(linuxDir, "LICENSE"), "utf8")).to.equal("MIT License text\n");
	});

	test("writes no LICENSE anywhere when license is null", () => {
		const work = tmpDir();
		const dist = path.join(work, "dist");
		fs.mkdirSync(dist, { recursive: true });
		makeArchive(dist, "mytool_1.0.0_linux_amd64.tar.gz", "mytool");

		const targets = [
			{ filename: "mytool_1.0.0_linux_amd64.tar.gz", os: "linux", cpu: "x64", libc: null },
		];

		captureOutput(() =>
			generatePackages({ ...base, work, dist, targets, packageJsonTemplate: {}, license: null }),
		);

		expect(fs.existsSync(path.join(work, "pkg", "mytool", "LICENSE"))).to.be.false;
		expect(fs.existsSync(path.join(work, "pkg", "@mytool", "linux-x64", "LICENSE"))).to.be.false;
	});
});
