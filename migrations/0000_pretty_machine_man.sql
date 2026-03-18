CREATE TABLE "coaching_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"manager_id" integer NOT NULL,
	"manager_name" text NOT NULL,
	"category" text NOT NULL,
	"reason" text NOT NULL,
	"action_taken" text NOT NULL,
	"employee_response" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disciplinary_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"action_date" date NOT NULL,
	"occurrence_count" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"employee_name" text,
	"related_id" integer,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"job_title" text NOT NULL,
	"max_weekly_hours" integer DEFAULT 40 NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_hidden_from_schedule" boolean DEFAULT false NOT NULL,
	"location" text,
	"employment_type" text,
	"ukg_employee_id" text,
	"preferred_days_per_week" integer DEFAULT 5,
	"non_working_days" text[],
	"hire_date" date,
	"alternate_email" text,
	CONSTRAINT "employees_ukg_employee_id_unique" UNIQUE("ukg_employee_id")
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_weekly_hours_limit" integer DEFAULT 1000 NOT NULL,
	"manager_morning_start" text DEFAULT '08:00' NOT NULL,
	"manager_morning_end" text DEFAULT '16:30' NOT NULL,
	"manager_evening_start" text DEFAULT '12:00' NOT NULL,
	"manager_evening_end" text DEFAULT '20:30' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"cashiering_percent" integer DEFAULT 40 NOT NULL,
	"donation_pricing_percent" integer DEFAULT 35 NOT NULL,
	"donor_greeting_percent" integer DEFAULT 25 NOT NULL,
	"openers_required" integer DEFAULT 2 NOT NULL,
	"closers_required" integer DEFAULT 2 NOT NULL,
	"managers_required" integer DEFAULT 1 NOT NULL,
	"hr_notification_email" text,
	"ukg_api_url" text,
	"ukg_username" text,
	"ukg_password" text
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"weekly_hours_limit" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"apparel_processor_stations" integer DEFAULT 0 NOT NULL,
	"donation_pricing_stations" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"related_trade_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "occurrence_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"adjustment_date" date NOT NULL,
	"adjustment_type" text NOT NULL,
	"adjustment_value" integer DEFAULT -100 NOT NULL,
	"calendar_year" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"retracted_reason" text,
	"retracted_at" timestamp,
	"retracted_by" integer
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"occurrence_date" date NOT NULL,
	"occurrence_type" text NOT NULL,
	"occurrence_value" integer NOT NULL,
	"hours_missed" integer,
	"reason" text,
	"illness_group_id" text,
	"is_ncns" boolean DEFAULT false NOT NULL,
	"is_fmla" boolean DEFAULT false NOT NULL,
	"is_consecutive_sickness" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"retracted_reason" text,
	"retracted_at" timestamp,
	"retracted_by" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"notes" text,
	"document_url" text
);
--> statement-breakpoint
CREATE TABLE "published_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"published_by" integer,
	"published_at" timestamp DEFAULT now(),
	CONSTRAINT "published_schedules_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
CREATE TABLE "role_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_title" text NOT NULL,
	"required_weekly_hours" integer NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	CONSTRAINT "role_requirements_job_title_unique" UNIQUE("job_title")
);
--> statement-breakpoint
CREATE TABLE "schedule_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"shift_patterns" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"requester_id" integer NOT NULL,
	"responder_id" integer NOT NULL,
	"requester_shift_id" integer NOT NULL,
	"responder_shift_id" integer NOT NULL,
	"status" text DEFAULT 'pending_peer' NOT NULL,
	"requester_note" text,
	"responder_note" text,
	"manager_note" text,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_clock_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"ukg_employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"clock_in" text,
	"clock_out" text,
	"regular_hours" integer DEFAULT 0 NOT NULL,
	"overtime_hours" integer DEFAULT 0 NOT NULL,
	"total_hours" integer DEFAULT 0 NOT NULL,
	"location_id" integer,
	"job_id" integer,
	"paycode_id" integer DEFAULT 0 NOT NULL,
	"ukg_status" integer,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_clock_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"ukg_employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"clock_in" text,
	"clock_out" text,
	"regular_hours" integer DEFAULT 0 NOT NULL,
	"overtime_hours" integer DEFAULT 0 NOT NULL,
	"total_hours" integer DEFAULT 0 NOT NULL,
	"location_id" integer,
	"job_id" integer,
	"paycode_id" integer DEFAULT 0 NOT NULL,
	"ukg_status" integer,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"location_ids" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"microsoft_id" text,
	"created_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_employees_is_active" ON "employees" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_employees_email" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_employees_location" ON "employees" USING btree ("location");--> statement-breakpoint
CREATE INDEX "idx_shifts_start_time" ON "shifts" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_shifts_employee_id" ON "shifts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_shifts_start_end" ON "shifts" USING btree ("start_time","end_time");--> statement-breakpoint
CREATE UNIQUE INDEX "time_clock_employee_date_idx" ON "time_clock_entries" USING btree ("ukg_employee_id","work_date");