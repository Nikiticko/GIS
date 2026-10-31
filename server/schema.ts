import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
export const workTypes = pgTable("work_types", { id: id(), name: text("name").notNull(), active: boolean("active").notNull().default(true) });
export const vehicles = pgTable("vehicles", { id: id(), name: text("name").notNull(), registration: text("registration").notNull(), active: boolean("active").notNull().default(true) });
export const projects = pgTable("production_projects", {
  id: id(), name: text("name").notNull(), managerId: uuid("manager_id").notNull().references(() => users.id),
  creatorId: uuid("creator_id").notNull().references(() => users.id), workTypeId: uuid("work_type_id").notNull().references(() => workTypes.id),
  address: text("address"), gps: text("gps"), volume: text("volume"), information: text("information"),
  desiredStart: date("desired_start"), desiredEnd: date("desired_end"), plannedStart: date("planned_start"), plannedEnd: date("planned_end"),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("project_location_check", sql`coalesce(length(trim(${t.address})), 0) > 0 or coalesce(length(trim(${t.gps})), 0) > 0`),
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
  name: text("name").notNull(), storageKey: text("storage_key").notNull().unique(), contentType: text("content_type").notNull(), size: integer("size").notNull(), createdAt: createdAt(), deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("attachments_project_idx").on(t.projectId)]);
export const notifications = pgTable("notifications", {
  id: id(), userId: uuid("user_id").notNull().references(() => users.id), type: text("type").notNull(), projectId: uuid("project_id").references(() => projects.id), subjectUserId: uuid("subject_user_id").references(() => users.id), createdAt: createdAt(), readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);
export const audit = pgTable("audit", {
  id: id(), actorId: uuid("actor_id").notNull().references(() => users.id), entityType: text("entity_type").notNull(), entityId: uuid("entity_id").notNull(), action: text("action").notNull(), field: text("field"), oldValue: text("old_value"), newValue: text("new_value"), createdAt: createdAt(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)]);
