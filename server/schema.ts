import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(), name: text("name").notNull(), role: text("role").notNull(), phone: text("phone"),
  active: boolean("active").notNull().default(true), foreman: boolean("foreman").notNull().default(false),
  keyCode: text("key_code").notNull().unique(), createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("users_role_check", sql`${t.role} in ('ADMIN', 'MANAGER', 'PRODUCTION_HEAD', 'PRODUCTION_EMPLOYEE')`),
  check("users_code_check", sql`${t.keyCode} ~ '^[0-9]{6}$'`),
  check("users_foreman_check", sql`not ${t.foreman} or ${t.role} = 'PRODUCTION_EMPLOYEE'`),
  uniqueIndex("one_admin").on(t.role).where(sql`${t.role} = 'ADMIN'`)]);
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), userId: uuid("user_id").notNull().references(() => users.id), createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);
export const loginAttempts = pgTable("login_attempts", {
  id: text("id").primaryKey(), startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), count: integer("count").notNull(),
});
export const workTypes = pgTable("work_types", { id: id(), name: text("name").notNull(), active: boolean("active").notNull().default(true) });
export const vehicles = pgTable("vehicles", { id: id(), name: text("name").notNull(), registration: text("registration").notNull(), active: boolean("active").notNull().default(true) });
export const projects = pgTable("production_projects", {
  id: id(), name: text("name").notNull(), managerId: uuid("manager_id").notNull().references(() => users.id),
  creatorId: uuid("creator_id").notNull().references(() => users.id), workTypeId: uuid("work_type_id").notNull().references(() => workTypes.id),
  address: text("address"), locationUrl: text("gps"), volume: text("volume"), information: text("information"),
  desiredStart: date("desired_start"), desiredEnd: date("desired_end"), plannedStart: date("planned_start"), plannedEnd: date("planned_end"),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("project_location_check", sql`coalesce(length(trim(${t.address})), 0) > 0`),
  check("project_desired_dates_check", sql`(${t.desiredStart} is null and ${t.desiredEnd} is null) or (${t.desiredStart} is not null and ${t.desiredEnd} is not null and ${t.desiredEnd} >= ${t.desiredStart})`),
  check("project_planned_dates_check", sql`(${t.plannedStart} is null and ${t.plannedEnd} is null) or (${t.plannedStart} is not null and ${t.plannedEnd} is not null and ${t.plannedEnd} >= ${t.plannedStart})`),
  index("production_projects_manager_idx").on(t.managerId)]);
export const assignments = pgTable("production_assignments", {
  id: id(), projectId: uuid("project_id").notNull().references(() => projects.id), userId: uuid("user_id").notNull().references(() => users.id), responsible: boolean("responsible").notNull().default(false),
}, (t) => [uniqueIndex("assignment_project_user_idx").on(t.projectId, t.userId), uniqueIndex("assignment_responsible_idx").on(t.projectId).where(sql`${t.responsible}`), index("assignment_user_idx").on(t.userId)]);
export const projectVehicles = pgTable("production_project_vehicles", {
  projectId: uuid("project_id").notNull().references(() => projects.id), vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id),
}, (t) => [uniqueIndex("project_vehicle_idx").on(t.projectId, t.vehicleId), index("project_vehicle_vehicle_idx").on(t.vehicleId)]);
export const attachments = pgTable("attachments", {
  id: id(), projectId: uuid("project_id").notNull().references(() => projects.id), uploaderId: uuid("uploader_id").notNull().references(() => users.id),
  name: text("name").notNull(), storageKey: text("storage_key").notNull().unique(), contentType: text("content_type").notNull(), size: integer("size").notNull(), createdAt: createdAt(), deletedAt: timestamp("deleted_at", { withTimezone: true }), storageDeletedAt: timestamp("storage_deleted_at", { withTimezone: true }),
}, (t) => [index("attachments_project_idx").on(t.projectId), index("attachments_cleanup_idx").on(t.id).where(sql`${t.deletedAt} is not null and ${t.storageDeletedAt} is null`)]);
export const notifications = pgTable("notifications", {
  id: id(), userId: uuid("user_id").notNull().references(() => users.id), type: text("type").notNull(), projectId: uuid("project_id").references(() => projects.id), subjectUserId: uuid("subject_user_id").references(() => users.id), payload: jsonb("payload").$type<NotificationPayload>(), createdAt: createdAt(), readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);
export type NotificationPayload = { actor: string; projectName: string; manager?: string; start?: string | null; end?: string | null; workType?: string; volume?: string | null; team?: string[]; vehicles?: string[]; changes?: { field: string; before: string | null; after: string | null }[] };
export const telegramLinks = pgTable("telegram_links", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull().unique(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  username: text("username"),
  createdAt: createdAt(),
});
export const telegramLinkTokens = pgTable("telegram_link_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("telegram_link_tokens_user_idx").on(t.userId)]);
export const telegramDeliveries = pgTable("telegram_deliveries", {
  notificationId: uuid("notification_id").primaryKey().references(() => notifications.id, { onDelete: "cascade" }),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (t) => [index("telegram_deliveries_pending_idx").on(t.nextAttemptAt).where(sql`${t.sentAt} is null`)]);
export const audit = pgTable("audit", {
  id: id(), actorId: uuid("actor_id").notNull().references(() => users.id), entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), action: text("action").notNull(), field: text("field"), oldValue: text("old_value"), newValue: text("new_value"), createdAt: createdAt(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)]);
