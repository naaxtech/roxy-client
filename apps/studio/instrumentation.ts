export async function onRequestError(
  error: { digest: string } & Error,
  request: { path: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  const { captureServerException, getPostHogServer } = await import('./lib/posthog-server');
  captureServerException(error, {
    error_context: 'onRequestError',
    path: request.path,
    route: context.routePath ?? null,
    route_type: context.routeType ?? null,
    digest: error.digest,
  });
  // Serverless can freeze the isolate before the batch ships.
  try {
    await getPostHogServer()?.flush();
  } catch {}
}
