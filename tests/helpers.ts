import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withBinOverride } from "#src/utils.ts";

process.env.GITHUB_ACTIONS = "true";

export function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "publish-npm-test-"));
}

export function withStubBin<T>(name: string, scriptBody: string, fn: () => T): T {
	const dir = tmpDir();
	const binPath = path.join(dir, name);
	fs.writeFileSync(binPath, `#!/bin/bash\n${scriptBody}\n`, { mode: 0o755 });
	return withBinOverride(name, binPath, fn);
}

export function nextMicrotask(): Promise<void> {
	return new Promise((resolve) => queueMicrotask(resolve));
}

export function captureOutput<T>(fn: () => T): { result: T; logs: string[] } {
	const logs: string[] = [];

	const stdoutWrite = process.stdout.write.bind(process.stdout);
	const stderrWrite = process.stderr.write.bind(process.stderr);
	process.stdout.write = ((chunk: Uint8Array | string) => {
		logs.push(chunk.toString());
		return true;
	}) as typeof process.stdout.write;
	process.stderr.write = ((chunk: Uint8Array | string) => {
		logs.push(chunk.toString());
		return true;
	}) as typeof process.stderr.write;

	const original = {
		log: console.log,
		error: console.error,
		group: console.group,
		groupEnd: console.groupEnd,
	};
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	console.error = (...args: unknown[]) => logs.push(args.join(" "));
	console.group = (...args: unknown[]) => logs.push(args.join(" "));
	console.groupEnd = () => {};

	try {
		const result = fn();
		return { result, logs };
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
		Object.assign(console, original);
	}
}
