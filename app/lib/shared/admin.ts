import { z } from "zod";

export const userStatusSchema = z.enum(["pending", "active", "suspended"]);

export const resolveGithubUserSchema = z.strictObject({
  username: z.string().min(1).max(39),
});

export const createUserSchema = z.strictObject({
  grants: z.array(z.string().min(1).max(253)).max(50).default([]),
  isAdmin: z.boolean().default(false),
  note: z.string().trim().max(500).nullable().default(null),
  status: userStatusSchema.default("pending"),
  username: z.string().min(1).max(39),
});

export const updateUserSchema = z
  .strictObject({
    grants: z.array(z.string().min(1).max(253)).max(50).optional(),
    isAdmin: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    status: userStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少需要提供一個更新欄位");

export const adminUsersQuerySchema = z.object({
  admin: z.enum(["all", "yes", "no"]).default("all"),
  namespace: z.string().max(253).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).default(""),
  status: z.enum(["all", "pending", "active", "suspended"]).default("all"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
