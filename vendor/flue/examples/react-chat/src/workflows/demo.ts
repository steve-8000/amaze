import type { FlueContext } from '@flue/runtime';

export async function run({ id, log, payload }: FlueContext) {
	log.info('workflow started', { runId: id });
	await new Promise((resolve) => setTimeout(resolve, 500));
	log.info('workflow received payload', { payload });
	await new Promise((resolve) => setTimeout(resolve, 500));
	log.info('workflow completed');
	return { ok: true, payload };
}
