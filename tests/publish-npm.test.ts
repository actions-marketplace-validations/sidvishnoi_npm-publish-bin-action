import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { expect } from "chai";
import { publishNpm } from "#src/publish-npm.ts";
import { captureOutput, tmpDir, withStubBin } from "./helpers.ts";

// `npm view` always reports "not published" unless overridden, so platform
// packages proceed to a real (stubbed) publish by default.
const NPM_STUB = `
if [ "$1" = "view" ]; then
  exit 1
fi
echo "$@" >> "$LOG"
`;

describe("publishNpm", () => {
	test("publishes platform packages before the main package", () => {
		const work = tmpDir();
		const mainDir = path.join(work, "pkg", "mytool");
		const platformPackages = [
			{ dir: path.join(work, "pkg", "@mytool", "darwin-arm64"), name: "@mytool/darwin-arm64" },
			{ dir: path.join(work, "pkg", "@mytool", "linux-x64"), name: "@mytool/linux-x64" },
		];

		const log = path.join(work, "npm-calls.log");
		withStubBin("npm", `LOG="${log}"\n${NPM_STUB}`, () => {
			captureOutput(() =>
				publishNpm({ packageName: "mytool", version: "1.2.3", mainDir, platformPackages }),
			);
		});

		const calls = fs.readFileSync(log, "utf8").trim().split("\n");
		expect(calls).to.have.length(3);
		expect(calls[2]).to.match(/pkg\/mytool$/);
		expect(calls.slice(0, 2).every((c) => /pkg\/@mytool\/(darwin-arm64|linux-x64)$/.test(c))).to.be
			.true;
	});

	test("warns and skips a platform package that's already published, but still publishes the rest", () => {
		const work = tmpDir();
		const mainDir = path.join(work, "pkg", "mytool");
		const platformPackages = [
			{ dir: path.join(work, "pkg", "@mytool", "darwin-arm64"), name: "@mytool/darwin-arm64" },
			{ dir: path.join(work, "pkg", "@mytool", "linux-x64"), name: "@mytool/linux-x64" },
		];

		const log = path.join(work, "npm-calls.log");
		const script = `
LOG="${log}"
if [ "$1" = "view" ]; then
  [ "$2" = "@mytool/darwin-arm64@1.2.3" ] && exit 0 || exit 1
fi
if [ "$1" = "publish" ] && [[ "$*" == *"darwin-arm64" ]]; then
  echo "npm ERR! cannot publish over the previously published version" >&2
  exit 1
fi
echo "$@" >> "$LOG"
`;

		const { logs } = withStubBin("npm", script, () =>
			captureOutput(() =>
				publishNpm({ packageName: "mytool", version: "1.2.3", mainDir, platformPackages }),
			),
		);

		expect(logs.some((l) => l.includes("skipping @mytool/darwin-arm64@1.2.3"))).to.be.true;

		const calls = fs.readFileSync(log, "utf8").trim().split("\n");
		expect(calls).to.have.length(2);
		expect(calls[0]).to.match(/pkg\/@mytool\/linux-x64$/);
		expect(calls[1]).to.match(/pkg\/mytool$/);
	});

	test("re-throws when a platform package publish fails for a reason other than already-published", () => {
		const work = tmpDir();
		const mainDir = path.join(work, "pkg", "mytool");
		const platformPackages = [
			{ dir: path.join(work, "pkg", "@mytool", "linux-x64"), name: "@mytool/linux-x64" },
		];

		const script = `
if [ "$1" = "view" ]; then
  exit 1
fi
if [ "$1" = "publish" ]; then
  echo "npm ERR! 403 Forbidden" >&2
  exit 1
fi
`;

		withStubBin("npm", script, () => {
			captureOutput(() => {
				expect(() =>
					publishNpm({ packageName: "mytool", version: "1.2.3", mainDir, platformPackages }),
				).to.throw();
			});
		});
	});

	test("fails if the main package is already published", () => {
		const work = tmpDir();
		const mainDir = path.join(work, "pkg", "mytool");
		const platformPackages = [
			{ dir: path.join(work, "pkg", "@mytool", "linux-x64"), name: "@mytool/linux-x64" },
		];

		const script = `
if [ "$1" = "view" ]; then
  exit 1
fi
if [ "$1" = "publish" ] && [[ "$*" == *"/pkg/mytool" ]]; then
  echo "npm ERR! You cannot publish over the previously published version" >&2
  exit 1
fi
`;

		withStubBin("npm", script, () => {
			captureOutput(() => {
				expect(() =>
					publishNpm({ packageName: "mytool", version: "1.2.3", mainDir, platformPackages }),
				).to.throw();
			});
		});
	});

	test("passes --dry-run through to every npm publish call when dryRun is true", () => {
		const work = tmpDir();
		const mainDir = path.join(work, "pkg", "mytool");
		const platformPackages = [
			{ dir: path.join(work, "pkg", "@mytool", "linux-x64"), name: "@mytool/linux-x64" },
		];

		const log = path.join(work, "npm-calls.log");
		withStubBin("npm", `LOG="${log}"\n${NPM_STUB}`, () => {
			captureOutput(() =>
				publishNpm({
					packageName: "mytool",
					version: "1.2.3",
					mainDir,
					platformPackages,
					dryRun: true,
				}),
			);
		});

		const calls = fs.readFileSync(log, "utf8").trim().split("\n");
		expect(calls).to.have.length(2);
		expect(calls.every((c) => c.includes("--dry-run"))).to.be.true;
	});

	test("passes --provenance through to every npm publish call when provenance is true", () => {
		const work = tmpDir();
		const mainDir = path.join(work, "pkg", "mytool");
		const platformPackages = [
			{ dir: path.join(work, "pkg", "@mytool", "linux-x64"), name: "@mytool/linux-x64" },
		];

		const log = path.join(work, "npm-calls.log");
		withStubBin("npm", `LOG="${log}"\n${NPM_STUB}`, () => {
			captureOutput(() =>
				publishNpm({
					packageName: "mytool",
					version: "1.2.3",
					mainDir,
					platformPackages,
					provenance: true,
				}),
			);
		});

		const calls = fs.readFileSync(log, "utf8").trim().split("\n");
		expect(calls).to.have.length(2);
		expect(calls.every((c) => c.includes("--provenance"))).to.be.true;
	});
});
