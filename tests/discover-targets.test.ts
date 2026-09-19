import { describe, test } from "node:test";
import { expect } from "chai";
import {
	detectCpu,
	detectLibc,
	detectOs,
	discoverTargets,
	type IDiscoverTargets,
	parseTargets,
	stripArchiveExtension,
	tokenize,
} from "#src/discover-targets.ts";
import { captureOutput, withStubBin } from "./helpers.ts";

describe("tokenize", () => {
	test("splits on non-alphanumeric and adds adjacent-pair joins", () => {
		expect(tokenize("x86_64-unknown-linux-gnu")).to.deep.equal([
			"x86",
			"64",
			"unknown",
			"linux",
			"gnu",
			"x86_64",
			"64_unknown",
			"unknown_linux",
			"linux_gnu",
		]);
	});
});

describe("stripArchiveExtension", () => {
	test("recognizes common archive formats", () => {
		expect(stripArchiveExtension("foo.tar.gz")).to.deep.equal({ base: "foo", ext: ".tar.gz" });
		expect(stripArchiveExtension("foo.tgz")).to.deep.equal({ base: "foo", ext: ".tgz" });
		expect(stripArchiveExtension("foo.tar.xz")).to.deep.equal({ base: "foo", ext: ".tar.xz" });
		expect(stripArchiveExtension("foo.tar.bz2")).to.deep.equal({ base: "foo", ext: ".tar.bz2" });
		expect(stripArchiveExtension("foo.tar.zst")).to.deep.equal({ base: "foo", ext: ".tar.zst" });
		expect(stripArchiveExtension("foo.zip")).to.deep.equal({ base: "foo", ext: ".zip" });
		expect(stripArchiveExtension("FOO.ZIP")).to.deep.equal({ base: "FOO", ext: ".zip" });
		expect(stripArchiveExtension("foo.txt")).to.deep.equal({ base: null, ext: null });
	});
});

describe("detectOs/detectCpu/detectLibc", () => {
	test("recognize alternate keyword spellings", () => {
		expect(detectOs(tokenize("mytool-macos-x64"))).to.equal("darwin");
		expect(detectOs(tokenize("mytool-osx-x64"))).to.equal("darwin");
		expect(detectOs(tokenize("mytool-win64-x64"))).to.equal("win32");
		expect(detectOs(tokenize("mytool-win-x64"))).to.equal("win32");
		expect(detectCpu(tokenize("mytool-linux-i686"))).to.equal("ia32");
		expect(detectCpu(tokenize("mytool-linux-armv7"))).to.equal("arm");
		expect(detectCpu(tokenize("mytool-linux-armhf"))).to.equal("arm");
		expect(detectOs(tokenize("mytool-nonsense"))).to.be.null;
		expect(detectCpu(tokenize("mytool-nonsense"))).to.be.null;
	});

	test("recognizes gnu/glibc and musl tokens, null otherwise", () => {
		expect(detectLibc(tokenize("mytool-x86_64-unknown-linux-gnu"))).to.equal("glibc");
		expect(detectLibc(tokenize("mytool-x86_64-unknown-linux-musl"))).to.equal("musl");
		expect(detectLibc(tokenize("mytool_1.2.3_linux_amd64"))).to.be.null;
	});
});

describe("parseTargets", () => {
	test("parses goreleaser-style asset names", () => {
		const { targets, skipped } = parseTargets(
			[
				"mytool_1.2.3_linux_amd64.tar.gz",
				"mytool_1.2.3_linux_arm64.tar.gz",
				"mytool_1.2.3_darwin_amd64.tar.gz",
				"mytool_1.2.3_darwin_arm64.tar.gz",
				"mytool_1.2.3_windows_amd64.zip",
				"mytool_1.2.3_windows_arm64.zip",
				"checksums.txt",
			],
			"mytool",
		);

		expect(targets).to.have.length(6);
		expect(targets.map((t) => [t.os, t.cpu])).to.deep.equal([
			["linux", "x64"],
			["linux", "arm64"],
			["darwin", "x64"],
			["darwin", "arm64"],
			["win32", "x64"],
			["win32", "arm64"],
		]);
		expect(skipped).to.have.length(0);
	});

	test("parses Rust target-triple asset names, keeping glibc and musl builds as separate targets", () => {
		const { targets, skipped } = parseTargets(
			[
				"mytool-x86_64-unknown-linux-gnu.tar.gz",
				"mytool-x86_64-unknown-linux-musl.tar.gz",
				"mytool-aarch64-apple-darwin.tar.gz",
				"mytool-x86_64-pc-windows-msvc.zip",
				"mytool.sbom.json",
				"mytool-source.tar.gz",
			],
			"mytool",
		);

		expect(targets.map((t) => [t.filename, t.os, t.cpu, t.libc])).to.deep.equal([
			["mytool-x86_64-unknown-linux-gnu.tar.gz", "linux", "x64", "glibc"],
			["mytool-x86_64-unknown-linux-musl.tar.gz", "linux", "x64", "musl"],
			["mytool-aarch64-apple-darwin.tar.gz", "darwin", "arm64", null],
			["mytool-x86_64-pc-windows-msvc.zip", "win32", "x64", null],
		]);

		const reasons = new Map(skipped);
		expect(reasons.get("mytool.sbom.json")).to.match(/not a recognized archive format/);
		expect(reasons.get("mytool-source.tar.gz")).to.match(/could not detect/);
	});

	test("still dedupes when two assets share the exact same os/cpu/libc", () => {
		const { targets, skipped } = parseTargets(
			["mytool-linux-amd64.tar.gz", "mytool-linux-x86_64.tar.gz"],
			"mytool",
		);
		expect(targets).to.have.length(1);
		expect(targets[0]?.filename).to.equal("mytool-linux-amd64.tar.gz");
		const reasons = new Map(skipped);
		expect(reasons.get("mytool-linux-x86_64.tar.gz")).to.match(/duplicate os\/cpu\/libc/);
	});

	test("falls back to all assets when none mention bin-name", () => {
		const { targets } = parseTargets(["v1.2.3-linux-amd64.tar.gz"], "mytool");
		expect(targets).to.have.length(1);
	});

	test("skips the bin-name filter entirely when binName is empty", () => {
		const { targets } = parseTargets(
			["mytool-linux-amd64.tar.gz", "otherbin-darwin-arm64.tar.gz"],
			"",
		);
		expect(targets.map((t) => t.filename)).to.deep.equal([
			"mytool-linux-amd64.tar.gz",
			"otherbin-darwin-arm64.tar.gz",
		]);
	});
});

describe("discoverTargets", () => {
	const base: IDiscoverTargets = { tag: "v1.0.0", repo: "sidvishnoi/mytool", binName: "mytool" };

	test("matches targets from the release's assets", () => {
		const assetNames = [
			"checksums.txt",
			"mytool_1.0.0_linux_amd64.tar.gz",
			"mytool_1.0.0_darwin_arm64.tar.gz",
		];

		const { result } = withStubBin(
			"gh",
			`printf '%s\\n' ${assetNames.map((n) => `"${n}"`).join(" ")}`,
			() => captureOutput(() => discoverTargets(base)),
		);

		expect(result.targets.map((t) => [t.filename, t.os, t.cpu])).to.deep.equal([
			["mytool_1.0.0_linux_amd64.tar.gz", "linux", "x64"],
			["mytool_1.0.0_darwin_arm64.tar.gz", "darwin", "arm64"],
		]);
		expect(result.skipped).to.deep.equal([]);
	});

	test("mentions the libc variant in the matched-targets log when one was detected", () => {
		const assetNames = ["mytool-x86_64-unknown-linux-musl.tar.gz"];

		const { logs } = withStubBin("gh", `printf '%s\\n' "${assetNames[0]}"`, () =>
			captureOutput(() => discoverTargets(base)),
		);

		expect(logs.some((l) => l.includes("libc=musl"))).to.be.true;
	});

	test("throws when no asset matches a platform", () => {
		withStubBin("gh", `echo checksums.txt`, () => {
			captureOutput(() => {
				expect(() => discoverTargets(base)).to.throw(/could be matched to a platform/);
			});
		});
	});
});
