import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    githubId: text("github_id").notNull(),
    githubLogin: text("github_login").notNull(),
    githubName: text("github_name"),
    githubAvatarUrl: text("github_avatar_url").notNull(),
    githubProfileUrl: text("github_profile_url").notNull(),
    status: text("status", { enum: ["pending", "active", "suspended"] })
      .notNull()
      .default("pending"),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (table) => [
    uniqueIndex("users_github_id_uq").on(table.githubId),
    index("users_status_idx").on(table.status),
    index("users_login_idx").on(table.githubLogin),
  ],
);

export const namespaceGrants = sqliteTable(
  "namespace_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    namespace: text("namespace").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("namespace_grants_user_namespace_uq").on(
      table.userId,
      table.namespace,
    ),
    index("namespace_grants_user_idx").on(table.userId),
    index("namespace_grants_namespace_idx").on(table.namespace),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    revokedAt: integer("revoked_at"),
    ipHash: text("ip_hash").notNull(),
    userAgentHash: text("user_agent_hash").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    namespace: text("namespace"),
    hostname: text("hostname"),
    status: text("status", { enum: ["success", "denied", "error"] }).notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    ipHash: text("ip_hash").notNull(),
    userAgentSummary: text("user_agent_summary").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorUserId),
    index("audit_logs_namespace_idx").on(table.namespace),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_request_idx").on(table.requestId),
  ],
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: text("id").primaryKey(),
    stateHash: text("state_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (table) => [
    uniqueIndex("oauth_states_state_hash_uq").on(table.stateHash),
    index("oauth_states_expiry_idx").on(table.expiresAt),
  ],
);

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const userRelations = relations(users, ({ many }) => ({
  grants: many(namespaceGrants),
  sessions: many(sessions),
}));

export const grantRelations = relations(namespaceGrants, ({ one }) => ({
  user: one(users, {
    fields: [namespaceGrants.userId],
    references: [users.id],
  }),
}));

export const sessionRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NamespaceGrant = typeof namespaceGrants.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
