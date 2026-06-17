import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, it } from 'node:test';

const cli = new URL('../dist/flue.js', import.meta.url);

async function runCli(args) {
	const child = spawn(process.execPath, [cli.pathname, ...args], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	const [code, signal] = await once(child, 'exit');
	return { code, signal, stdout, stderr };
}

describe('flue docs', () => {
	it('lists readable page paths on stdout when run without arguments', async () => {
		const list = await runCli(['docs']);
		assert.equal(list.code, 0);

		const lines = list.stdout.trim().split('\n');
		assert.ok(lines.length > 10, `expected a catalog of pages, got ${lines.length} lines`);

		// The catalog is the machine-readable payload; help text stays on stderr.
		assert.ok(!list.stdout.includes('flue docs read <path>'));
		assert.ok(list.stderr.includes('flue docs read <path>'));

		// Round-trip: every listed path must be readable.
		const firstPath = lines[0].split(/\s+/)[0];
		const read = await runCli(['docs', 'read', firstPath]);
		assert.equal(read.code, 0);
		assert.ok(read.stdout.startsWith('# '), 'page output starts with a markdown title');
	});

	it('accepts website URL forms when reading a page', async () => {
		const list = await runCli(['docs']);
		const firstPath = list.stdout.trim().split('\n')[0].split(/\s+/)[0];

		const plain = await runCli(['docs', 'read', firstPath]);
		const urlForm = await runCli(['docs', 'read', `/docs/${firstPath}/`]);
		assert.equal(urlForm.code, 0);
		assert.equal(urlForm.stdout, plain.stdout);
	});

	it('exits with guidance when the page is unknown', async () => {
		const result = await runCli(['docs', 'read', 'not/a-real-page']);
		assert.equal(result.code, 1);
		assert.equal(result.stdout, '');
		assert.ok(result.stderr.includes('flue docs search'));
	});

	it('prints valid JSON results with readable paths when searching', async () => {
		const result = await runCli(['docs', 'search', 'agent']);
		assert.equal(result.code, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.query, 'agent');
		assert.ok(payload.results.length > 0, 'expected at least one result');
		for (const entry of payload.results) {
			assert.equal(typeof entry.path, 'string');
			assert.equal(typeof entry.title, 'string');
			assert.equal(typeof entry.excerpt, 'string');
			assert.equal(typeof entry.score, 'number');
		}

		const read = await runCli(['docs', 'read', payload.results[0].path]);
		assert.equal(read.code, 0);
	});

	it('exits with usage when the search query is missing', async () => {
		const result = await runCli(['docs', 'search']);
		assert.equal(result.code, 1);
		assert.ok(result.stderr.includes('flue docs search <query>'));
	});
});
