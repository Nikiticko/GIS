CREATE TABLE "production_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"responsible" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "production_project_vehicles" (
	"project_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"manager_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"work_type_id" uuid NOT NULL,
	"address" text,
	"gps" text,
	"volume" text,
	"information" text,
	"desired_start" date,
	"desired_end" date,
	"planned_start" date,
	"planned_end" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_location_check" CHECK (coalesce(length(trim("production_projects"."address")), 0) > 0 or coalesce(length(trim("production_projects"."gps")), 0) > 0),
	CONSTRAINT "project_desired_dates_check" CHECK (("production_projects"."desired_start" is null and "production_projects"."desired_end" is null) or ("production_projects"."desired_start" is not null and "production_projects"."desired_end" is not null and "production_projects"."desired_end" >= "production_projects"."desired_start")),
	CONSTRAINT "project_planned_dates_check" CHECK (("production_projects"."planned_start" is null and "production_projects"."planned_end" is null) or ("production_projects"."planned_start" is not null and "production_projects"."planned_end" is not null and "production_projects"."planned_end" >= "production_projects"."planned_start"))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"foreman" boolean DEFAULT false NOT NULL,
	"key_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_key_code_unique" UNIQUE("key_code"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('ADMIN', 'MANAGER', 'PRODUCTION_HEAD', 'PRODUCTION_EMPLOYEE')),
	CONSTRAINT "users_code_check" CHECK ("users"."key_code" ~ '^[0-9]{6}$'),
	CONSTRAINT "users_foreman_check" CHECK (not "users"."foreman" or "users"."role" = 'PRODUCTION_EMPLOYEE')
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"registration" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "production_assignments" ADD CONSTRAINT "production_assignments_project_id_production_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_assignments" ADD CONSTRAINT "production_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_production_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_production_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_project_vehicles" ADD CONSTRAINT "production_project_vehicles_project_id_production_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_project_vehicles" ADD CONSTRAINT "production_project_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_project_user_idx" ON "production_assignments" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_responsible_idx" ON "production_assignments" USING btree ("project_id") WHERE "production_assignments"."responsible";--> statement-breakpoint
CREATE INDEX "assignment_user_idx" ON "production_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_vehicle_idx" ON "production_project_vehicles" USING btree ("project_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "project_vehicle_vehicle_idx" ON "production_project_vehicles" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "production_projects_manager_idx" ON "production_projects" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'ADMIN';