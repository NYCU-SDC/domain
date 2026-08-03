import type { RouterContextProvider } from "react-router";

import { workerRuntimeContext, type WorkerRuntimeContext } from "../runtime-context";

export function getWorkerRuntime(context: Readonly<RouterContextProvider>): WorkerRuntimeContext {
	return context.get(workerRuntimeContext);
}
