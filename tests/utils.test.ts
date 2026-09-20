import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { expect } from "chai";
import {
	appendGithubEnv,
	env,
	readJsonFile,
	run,
	sh,
	withBinOverride,
	withGroup,
	writeJsonFile,
} from "#src/utils.ts";
import { captureOutput, nextMicrotask, tmpDir } from "./helpers.ts";

describe("run", () => {
	test("calls fn with the given arg, deferred to a microtask", async () => {
		const received: number[] = [];
		run((n: number) => received.push(n), 42);
		expect(received, "should not run synchronously").to.deep.equal([]);

		await nextMicrotask();
		expect(received).to.deep.equal([42]);
	});

	test("catches a thrown error, prints it as an ::error:: annotation, and exits with status 1", async () => {
		const originalExit = process.exit;
		const originalError = console.error;
		let exitCode: unknown;
		let errorMessage: unknown;
		process.exit = ((code?: number) => {
			exitCode = code;
		}) as never;
		console.error = (msg: unknown) => {
			errorMessage = msg;
		};

		try {
			run((_arg: number) => {
				throw new Error("boom");
			}, 42);
			await nextMicrotask();
		} finally {
			process.exit = originalExit;
			console.error = originalError;
		}

		expect(errorMessage).to.equal("::error::boom");
		expect(exitCode).to.equal(1);
	});

	test("prints a thrown non-Error value as an ::error:: annotation", async () => {
		const originalExit = process.exit;
		const originalError = console.error;
		let errorMessage: unknown;
		process.exit = (() => {}) as never;
		console.error = (msg: unknown) => {
			errorMessage = msg;
		};

		try {
			run((_arg: number) => {
				throw "boom";
			}, 42);
			await nextMicrotask();
		} finally {
			process.exit = originalExit;
			console.error = originalError;
		}

		expect(errorMessage).to.equal("::error::boom");
	});
});

describe("withGroup", () => {
	test("uses ::group::/::endgroup:: markers", () => {
		const { result, logs } = captureOutput(() => withGroup("label", () => 42));

		expect(result).to.equal(42);
		expect(logs).to.deep.equal(["::group::label", "::endgroup::"]);
	});
});

describe("sh", () => {
	test("runs a command and returns trimmed stdout", () => {
		const { result } = captureOutput(() => sh`echo ${"  hello  "}`);
		expect(result).to.equal("hello");
	});

	test("spreads array values into separate argv entries", () => {
		const { result } = captureOutput(() => sh`echo ${["a", "b"]} c`);
		expect(result).to.equal("a b c");
	});

	test("throws on a non-zero exit", () => {
		captureOutput(() => {
			expect(() => sh`sh -c ${"exit 1"}`).to.throw();
		});
	});

	test("prints the command and its output inside a group", () => {
		const { logs } = captureOutput(() => sh`echo hi`);
		expect(logs.some((l) => l.includes("echo hi"))).to.be.true;
		expect(logs.some((l) => l.includes("hi"))).to.be.true;
	});

	test("prints stderr output too", () => {
		const { logs } = captureOutput(() => sh`sh -c ${"echo oops 1>&2"}`);
		expect(logs.some((l) => l.includes("oops"))).to.be.true;
	});

	test("throws on a command that can't be spawned", () => {
		captureOutput(() => {
			expect(() => sh`publish-npm-test-nonexistent-binary`).to.throw();
		});
	});

	test("throws on an empty command", () => {
		captureOutput(() => {
			expect(() => sh``).to.throw(/empty command/);
		});
	});
});

describe("withBinOverride", () => {
	test("makes sh() resolve the named command to the given path", () => {
		const dir = tmpDir();
		const binPath = path.join(dir, "publish-npm-test-echo");
		fs.writeFileSync(binPath, "#!/bin/bash\necho overridden\n", { mode: 0o755 });

		const { result } = captureOutput(() =>
			withBinOverride("publish-npm-test-echo", binPath, () => sh`publish-npm-test-echo`),
		);
		expect(result).to.equal("overridden");
	});

	test("restores the previous override when nested for the same name", () => {
		const dir = tmpDir();
		const outer = path.join(dir, "outer");
		const inner = path.join(dir, "inner");
		fs.writeFileSync(outer, "#!/bin/bash\necho outer\n", { mode: 0o755 });
		fs.writeFileSync(inner, "#!/bin/bash\necho inner\n", { mode: 0o755 });

		const { result } = captureOutput(() =>
			withBinOverride("publish-npm-test-echo", outer, () => {
				const before = sh`publish-npm-test-echo`;
				const inside = withBinOverride(
					"publish-npm-test-echo",
					inner,
					() => sh`publish-npm-test-echo`,
				);
				const after = sh`publish-npm-test-echo`;
				return { before, inside, after };
			}),
		);
		expect(result).to.deep.equal({ before: "outer", inside: "inner", after: "outer" });
	});
});

describe("readJsonFile/writeJsonFile", () => {
	test("round-trip", () => {
		const dir = tmpDir();
		const file = path.join(dir, "nested", "data.json");
		writeJsonFile(file, { a: 1, b: [2, 3] });
		expect(readJsonFile(file)).to.deep.equal({ a: 1, b: [2, 3] });
	});
});

describe("env", () => {
	test("throws when unset and no default is given", () => {
		delete process.env.PUBLISH_NPM_TEST_VAR;
		expect(() => env("PUBLISH_NPM_TEST_VAR")).to.throw();
	});

	test("returns the default when unset and one is given", () => {
		delete process.env.PUBLISH_NPM_TEST_VAR;
		expect(env("PUBLISH_NPM_TEST_VAR", "fallback")).to.equal("fallback");
	});

	test("returns the value when set, regardless of a default", () => {
		process.env.PUBLISH_NPM_TEST_VAR = "x";
		expect(env("PUBLISH_NPM_TEST_VAR")).to.equal("x");
		expect(env("PUBLISH_NPM_TEST_VAR", "fallback")).to.equal("x");
		delete process.env.PUBLISH_NPM_TEST_VAR;
	});
});

describe("appendGithubEnv", () => {
	test("appends KEY=value lines", () => {
		const dir = tmpDir();
		const githubEnv = path.join(dir, "github_env");
		fs.writeFileSync(githubEnv, "EXISTING=1\n");
		process.env.GITHUB_ENV = githubEnv;

		appendGithubEnv({ FOO: "bar", BAZ: "qux" });

		const contents = fs.readFileSync(githubEnv, "utf8");
		expect(contents).to.equal("EXISTING=1\nFOO=bar\nBAZ=qux\n");

		delete process.env.GITHUB_ENV;
	});
});
