import type { RouterContextProvider } from "react-router";

import { workerRuntimeContext, type WorkerRuntimeContext } from "~/shared/runtime/worker-runtime-context";

export function getWorkerRuntime(context: Readonly<RouterContextProvider>): WorkerRuntimeContext {
	return context.get(workerRuntimeContext);
}
