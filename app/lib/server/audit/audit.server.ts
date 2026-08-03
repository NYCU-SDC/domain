import { AppError, toAppError } from "../../shared/errors";
import { hmacSha256Hex } from "../../shared/crypto";
import { requireSecret } from "../config.server";
import {
  getClientIp,
  summarizeUserAgent,
} from "../security/request.server";

export type AuditStatus = "denied" | "error" | "success";

export interface AuditEvent {
  readonly action: string;
  readonly actorUserId?: string | null;
  readonly after?: unknown;
  readonly before?: unknown;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly hostname?: string | null;
  readonly namespace?: string | null;
  readonly requestId: string;
  readonly status: AuditStatus;
  readonly targetId?: string | null;
  readonly targetType?: string | null;
}

const sensitiveKeyPattern = /authorization|cookie|secret|token|oauth.?code|verifier/iu;

function sanitizeSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limited]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 4096);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeSnapshot(item, depth + 1));
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = sensitiveKeyPattern.test(key)
        ? "[redacted]"
        : sanitizeSnapshot(item, depth + 1);
    }
    return sanitized;
  }
  if (typeof value === "bigint") return value.toString().slice(0, 512);
  return `[unsupported ${typeof value}]`;
}

function snapshotJson(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(sanitizeSnapshot(value)).slice(0, 16_384);
}

export async function writeAuditLog(
  database: D1Database,
  request: Request,
  env: Env,
  event: AuditEvent,
): Promise<void> {
  const statement = await prepareAuditStatement(database, request, env, event);
  await statement.run();
}

export async function prepareAuditStatement(
  database: D1Database,
  request: Request,
  env: Env,
  event: AuditEvent,
): Promise<D1PreparedStatement> {
  const now = Date.now();
  const ipHash = await hmacSha256Hex(
    requireSecret(env, "IP_HASH_SECRET"),
    getClientIp(request),
  );
  return database
    .prepare(
      `INSERT INTO audit_logs (
        id, request_id, actor_user_id, action, target_type, target_id,
        namespace, hostname, status, before_json, after_json, error_code,
        error_message, ip_hash, user_agent_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.requestId,
      event.actorUserId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      event.namespace ?? null,
      event.hostname ?? null,
      event.status,
      snapshotJson(event.before),
      snapshotJson(event.after),
      event.errorCode ?? null,
      event.errorMessage?.slice(0, 512) ?? null,
      ipHash,
      summarizeUserAgent(request),
      now,
    );
}

export function auditStatusForError(error: unknown): AuditStatus {
  const appError = toAppError(error);
  return appError.code === "FORBIDDEN" ||
    appError.code === "PROTECTED_RESOURCE" ||
    appError.code === "UNAUTHENTICATED"
    ? "denied"
    : "error";
}

export async function writeFailureAudit(
  database: D1Database,
  request: Request,
  env: Env,
  base: Omit<AuditEvent, "errorCode" | "errorMessage" | "status">,
  error: unknown,
): Promise<void> {
  const appError = toAppError(error);
  try {
    await writeAuditLog(database, request, env, {
      ...base,
      errorCode: appError.code,
      errorMessage: appError.message,
      status: auditStatusForError(error),
    });
  } catch (auditError) {
    console.error(
      JSON.stringify({
        action: base.action,
        error: auditError instanceof Error ? auditError.message : "Unknown audit error",
        message: "audit.write_failed",
        requestId: base.requestId,
      }),
    );
    if (!(error instanceof AppError)) throw error;
  }
}
