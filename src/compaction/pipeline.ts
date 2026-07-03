export type CompactionFilter<TContext> = (
	context: TContext,
) => TContext | Promise<TContext>;

export async function runCompactionPipeline<TContext>(
	initialContext: TContext,
	filters: Array<CompactionFilter<TContext>>,
): Promise<TContext> {
	let context = initialContext;
	for (const filter of filters) {
		context = await filter(context);
	}
	return context;
}
