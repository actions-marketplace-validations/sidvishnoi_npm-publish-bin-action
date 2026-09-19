import { appendGithubEnv, env, run, sh, withGroup } from "./utils.ts";

if (import.meta.main) {
	run(main, {
		tag: env("TAG"),
		repo: env("GITHUB_REPOSITORY"),
		binName: env("BIN_NAME"),
	});
}

function main(args: IDiscoverTargets): void {
	const { targets } = discoverTargets(args);
	appendGithubEnv({ TARGETS: JSON.stringify(targets) });
}

export interface IDiscoverTargets {
	tag: string;
	repo: string;
	binName: string;
}

export function discoverTargets({ tag, repo, binName }: IDiscoverTargets): ParseResult {
	const allAssetNames = sh`gh release view ${tag} --repo ${repo} --json assets --jq ${".assets[].name"}`;
	const assetNames = allAssetNames
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	withGroup(`Release assets (${assetNames.length})`, () => {
		for (const name of assetNames) console.log(`- ${name}`);
	});

	const { targets, skipped } = parseTargets(assetNames, binName);

	if (skipped.length > 0) {
		withGroup(`Skipped release assets (${skipped.length})`, () => {
			for (const [name, reason] of skipped) console.log(`- ${name}: ${reason}`);
		});
	}

	if (targets.length === 0) {
		throw new Error("No release assets could be matched to a platform.");
	}

	withGroup(`Matched targets (${targets.length})`, () => {
		for (const t of targets)
			console.log(`- ${t.filename} -> os=${t.os} cpu=${t.cpu}${t.libc ? ` libc=${t.libc}` : ""}`);
	});

	return { targets, skipped };
}

export interface ParseResult {
	targets: Target[];
	skipped: Array<[filename: string, reason: string]>;
}

export interface Target {
	filename: string;
	os: string;
	cpu: string;
	libc: string | null;
}

/**
 * When two assets resolve to the same os/cpu/libc, the first one wins - but
 * a glibc and a musl build of the same os/cpu are kept as separate targets,
 * since they're not interchangeable.
 */
export function parseTargets(assetNames: string[], binName: string): ParseResult {
	const lowerBinName = binName.toLowerCase();

	// If any asset name mentions the binary name, only consider those - avoids
	// picking up unrelated files from a release that bundles multiple projects.
	const relevant = lowerBinName
		? assetNames.filter((n) => n.toLowerCase().includes(lowerBinName))
		: assetNames;
	const candidates = relevant.length > 0 ? relevant : assetNames;

	const targets: Target[] = [];
	const skipped: Array<[string, string]> = [];

	for (const filename of candidates) {
		const { base } = stripArchiveExtension(filename);
		if (!base) {
			skipped.push([filename, "not a recognized archive format"]);
			continue;
		}

		const tokens = tokenize(base);
		const os = detectOs(tokens);
		const cpu = detectCpu(tokens);
		const libc = detectLibc(tokens);

		if (!os || !cpu) {
			const missing = [!os && "os", !cpu && "cpu"].filter(Boolean).join("/");
			skipped.push([filename, `could not detect ${missing} from name`]);
			continue;
		}

		const dupe = targets.find((t) => t.os === os && t.cpu === cpu && t.libc === libc);
		if (dupe) {
			skipped.push([
				filename,
				`duplicate os/cpu/libc (${os}/${cpu}/${libc}), already matched by ${dupe.filename}`,
			]);
			continue;
		}

		targets.push({ filename, os, cpu, libc });
	}

	return { targets, skipped };
}

const ARCHIVE_EXTENSIONS = [
	".tar.gz",
	".tgz",
	".tar.xz",
	".txz",
	".tar.bz2",
	".tbz2",
	".tar.zst",
	".tzst",
	".zip",
	".tar",
];

export function stripArchiveExtension(name: string): { base: string | null; ext: string | null } {
	const lower = name.toLowerCase();
	const ext = ARCHIVE_EXTENSIONS.find((e) => lower.endsWith(e)) ?? null;
	return { base: ext ? name.slice(0, -ext.length) : null, ext };
}

// ordered most-specific-first: the first rule that matches wins.
const OS_RULES: Record<string, (token: string) => boolean> = {
	darwin: (t) => ["darwin", "macos", "osx", "mac"].includes(t),
	linux: (t) => t === "linux",
	win32: (t) => ["windows", "win64", "win32", "win"].includes(t),
};

export function detectOs(tokens: string[]): string | null {
	return detect(OS_RULES, tokens);
}

const CPU_RULES: Record<string, (token: string) => boolean> = {
	arm64: (t) => t === "aarch64" || t === "arm64",
	x64: (t) => t === "x86_64" || t === "amd64" || t === "x64",
	ia32: (t) => ["i386", "i686", "x86"].includes(t),
	arm: (t) => t === "arm" || t === "armhf" || /^armv[5-7][a-z]?$/.test(t),
};

export function detectCpu(tokens: string[]): string | null {
	return detect(CPU_RULES, tokens);
}

const LIBC_RULES: Record<string, (token: string) => boolean> = {
	musl: (t) => t === "musl",
	glibc: (t) => t === "gnu" || t === "glibc",
};

export function detectLibc(tokens: string[]): string | null {
	return detect(LIBC_RULES, tokens);
}

export function tokenize(base: string): string[] {
	const tokens = base
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const pairs = tokens.slice(0, -1).map((t, i) => `${t}_${tokens[i + 1]}`);
	return [...tokens, ...pairs];
}

function detect(
	rules: Record<string, (token: string) => boolean>,
	tokens: string[],
): string | null {
	for (const [value, test] of Object.entries(rules)) {
		if (tokens.some(test)) return value;
	}
	return null;
}
