import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function run<A>(fn: (arg: A) => void, arg: A): void {
	queueMicrotask(() => {
		try {
			fn(arg);
		} catch (err) {
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		}
	});
}

export function withGroup<T>(label: string, fn: () => T): T {
	const inActions = process.env.GITHUB_ACTIONS === "true";
	if (inActions) console.log(`::group::${label}`);
	else console.group(label);
	try {
		return fn();
	} finally {
		if (inActions) console.log("::endgroup::");
		else console.groupEnd();
	}
}

type ShArg = string | number;
type ShValue = ShArg | ShArg[];

export function sh(parts: TemplateStringsArray, ...values: ShValue[]): string {
	const argv = parts.flatMap((literal, i) => {
		const words = literal.trim().split(/\s+/).filter(Boolean);
		const value = values[i];
		if (value === undefined) return words;
		return [...words, ...(Array.isArray(value) ? value.map(String) : [String(value)])];
	});

	const [command, ...args] = argv;
	if (!command) throw new Error("sh(): empty command");

	const resolvedCommand = binOverrides.get(command) ?? command;

	return withGroup(`$ ${argv.join(" ")}`, () => {
		const result = spawnSync(resolvedCommand, args, { encoding: "utf8" });
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		if (result.error) throw result.error;
		if (result.status !== 0) {
			throw new Error(`Command failed (exit ${result.status}): ${argv.join(" ")}`);
		}
		return result.stdout.trim();
	});
}

export function readJsonFile<T>(filePath: string): T {
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function writeJsonFile(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function env(name: string, defaultValue?: string): string {
	const value = process.env[name];
	if (value) return value;
	if (defaultValue !== undefined) return defaultValue;
	throw new Error(`Missing required env var: ${name}`);
}

export function appendGithubEnv(vars: Record<string, string>): void {
	const githubEnvPath = env("GITHUB_ENV");
	const lines = Object.entries(vars).map(([key, value]) => `${key}=${value}`);
	fs.appendFileSync(githubEnvPath, `${lines.join("\n")}\n`);
}

// test-only hook
const binOverrides = new Map<string, string>();
export function withBinOverride<T>(name: string, resolvedPath: string, fn: () => T): T {
	const previous = binOverrides.get(name);
	binOverrides.set(name, resolvedPath);
	try {
		return fn();
	} finally {
		if (previous === undefined) binOverrides.delete(name);
		else binOverrides.set(name, previous);
	}
}
