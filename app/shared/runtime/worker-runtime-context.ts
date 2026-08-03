import { createContext } from "react-router";

export interface WorkerRuntimeContext {
	readonly cspNonce: string;
	readonly ctx: ExecutionContext;
	readonly env: Env;
	readonly requestId: string;
}

export const workerRuntimeContext = createContext<WorkerRuntimeContext>();
