CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cuts` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit_id` integer NOT NULL,
	`method` text NOT NULL,
	`cut_length_mm` integer,
	`cut_width_mm` integer,
	`freehand_size_id` integer,
	`cut_area_mm2` integer NOT NULL,
	`used_area_mm2` integer NOT NULL,
	`remnant_area_mm2` integer DEFAULT 0 NOT NULL,
	`waste_area_mm2` integer NOT NULL,
	`reconciled_count_id` integer,
	`reconciled_area_mm2` integer,
	`notes` text,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`freehand_size_id`) REFERENCES `freehand_sizes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reconciled_count_id`) REFERENCES `physical_counts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cuts_method_check" CHECK("cuts"."method" IN ('MEASURED','FREEHAND')),
	CONSTRAINT "cuts_length_check" CHECK("cuts"."cut_length_mm" IS NULL OR "cuts"."cut_length_mm" > 0),
	CONSTRAINT "cuts_width_check" CHECK("cuts"."cut_width_mm" IS NULL OR "cuts"."cut_width_mm" > 0),
	CONSTRAINT "cuts_area_check" CHECK("cuts"."cut_area_mm2" > 0),
	CONSTRAINT "cuts_used_check" CHECK("cuts"."used_area_mm2" >= 0),
	CONSTRAINT "cuts_remnant_check" CHECK("cuts"."remnant_area_mm2" >= 0),
	CONSTRAINT "cuts_waste_check" CHECK("cuts"."waste_area_mm2" >= 0),
	CONSTRAINT "cuts_measured_check" CHECK("cuts"."method" = 'FREEHAND' OR ("cuts"."cut_length_mm" IS NOT NULL AND "cuts"."cut_width_mm" IS NOT NULL AND "cuts"."cut_area_mm2" = "cuts"."cut_length_mm" * "cuts"."cut_width_mm")),
	CONSTRAINT "cuts_freehand_waste_check" CHECK("cuts"."method" = 'MEASURED' OR "cuts"."waste_area_mm2" = 0),
	CONSTRAINT "cuts_measured_no_freehand_check" CHECK("cuts"."method" = 'FREEHAND' OR ("cuts"."freehand_size_id" IS NULL AND "cuts"."reconciled_count_id" IS NULL)),
	CONSTRAINT "cuts_conservation_check" CHECK("cuts"."used_area_mm2" + "cuts"."remnant_area_mm2" + "cuts"."waste_area_mm2" = "cuts"."cut_area_mm2")
);
--> statement-breakpoint
CREATE INDEX `cuts_pending_idx` ON `cuts` (`unit_id`,`method`,`reconciled_count_id`);--> statement-breakpoint
CREATE INDEX `cuts_created_idx` ON `cuts` (`created_at`);--> statement-breakpoint
CREATE TABLE `freehand_sizes` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ref_area_mm2` integer NOT NULL,
	`material_type` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	CONSTRAINT "freehand_area_check" CHECK("freehand_sizes"."ref_area_mm2" > 0)
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit_id` integer NOT NULL,
	`type` text NOT NULL,
	`area_mm2` integer NOT NULL,
	`cut_id` integer,
	`count_id` integer,
	`reason` text,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cut_id`) REFERENCES `cuts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`count_id`) REFERENCES `physical_counts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "movements_type_check" CHECK("inventory_movements"."type" IN ('INITIAL_IN','PURCHASE_IN','REMNANT_IN','CUT_OUT','FREEHAND_ADJUST','COUNT_ADJUST','MANUAL_ADJUST','DISCARD')),
	CONSTRAINT "movements_area_check" CHECK("inventory_movements"."area_mm2" <> 0),
	CONSTRAINT "movements_sign_check" CHECK(("inventory_movements"."type" IN ('INITIAL_IN','PURCHASE_IN','REMNANT_IN') AND "inventory_movements"."area_mm2" > 0) OR ("inventory_movements"."type" IN ('CUT_OUT','DISCARD') AND "inventory_movements"."area_mm2" < 0) OR "inventory_movements"."type" IN ('FREEHAND_ADJUST','COUNT_ADJUST','MANUAL_ADJUST'))
);
--> statement-breakpoint
CREATE INDEX `movements_unit_idx` ON `inventory_movements` (`unit_id`);--> statement-breakpoint
CREATE INDEX `movements_created_idx` ON `inventory_movements` (`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_units` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`material_id` integer NOT NULL,
	`kind` text NOT NULL,
	`width_mm` integer NOT NULL,
	`initial_length_mm` integer NOT NULL,
	`core_weight_g` integer,
	`parent_unit_id` integer,
	`source_cut_id` integer,
	`location` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`balance_mm2` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_cut_id`) REFERENCES `cuts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "units_kind_check" CHECK("inventory_units"."kind" IN ('ROLL','REMNANT')),
	CONSTRAINT "units_status_check" CHECK("inventory_units"."status" IN ('ACTIVE','DEPLETED','DISCARDED')),
	CONSTRAINT "units_width_check" CHECK("inventory_units"."width_mm" > 0),
	CONSTRAINT "units_length_check" CHECK("inventory_units"."initial_length_mm" > 0),
	CONSTRAINT "units_core_check" CHECK("inventory_units"."core_weight_g" IS NULL OR "inventory_units"."core_weight_g" >= 0),
	CONSTRAINT "units_balance_check" CHECK("inventory_units"."balance_mm2" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_code_unique` ON `inventory_units` (`code`);--> statement-breakpoint
CREATE INDEX `units_material_status_idx` ON `inventory_units` (`material_id`,`status`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`brand` text NOT NULL,
	`line` text,
	`color` text NOT NULL,
	`finish` text NOT NULL,
	`type` text NOT NULL,
	`grams_per_m2` integer,
	`cost_per_m2` integer,
	`min_stock_mm2` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "materials_finish_check" CHECK("materials"."finish" IN ('MATE','BRILLANTE','SATINADO','METALIZADO','CROMADO','CARBONO','TORNASOL','REFLECTIVO','TRANSPARENTE','OTRO')),
	CONSTRAINT "materials_type_check" CHECK("materials"."type" IN ('VINILO_CORTE','VINILO_IMPRESION','WRAP','LAMINADO','CALCA','OTRO')),
	CONSTRAINT "materials_gsm_check" CHECK("materials"."grams_per_m2" IS NULL OR "materials"."grams_per_m2" > 0),
	CONSTRAINT "materials_cost_check" CHECK("materials"."cost_per_m2" IS NULL OR "materials"."cost_per_m2" >= 0),
	CONSTRAINT "materials_min_stock_check" CHECK("materials"."min_stock_mm2" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_sku_unique` ON `materials` (`sku`);--> statement-breakpoint
CREATE TABLE `physical_counts` (
	`id` integer PRIMARY KEY NOT NULL,
	`unit_id` integer NOT NULL,
	`method` text NOT NULL,
	`measured_length_mm` integer,
	`measured_weight_g` integer,
	`computed_area_mm2` integer NOT NULL,
	`system_area_mm2` integer NOT NULL,
	`freehand_adjust_mm2` integer DEFAULT 0 NOT NULL,
	`unexplained_mm2` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `inventory_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "counts_method_check" CHECK("physical_counts"."method" IN ('LENGTH','WEIGHT')),
	CONSTRAINT "counts_computed_check" CHECK("physical_counts"."computed_area_mm2" >= 0),
	CONSTRAINT "counts_split_check" CHECK("physical_counts"."freehand_adjust_mm2" + "physical_counts"."unexplained_mm2" = "physical_counts"."computed_area_mm2" - "physical_counts"."system_area_mm2")
);
--> statement-breakpoint
CREATE INDEX `counts_unit_idx` ON `physical_counts` (`unit_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`is_active` integer DEFAULT true NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" IN ('ADMIN','EMPLOYEE','CLIENT')),
	CONSTRAINT "users_email_lower" CHECK("__new_users"."email" = lower(trim("__new_users"."email")))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "password_hash", "role", "full_name", "phone", "is_active", "failed_logins", "locked_until", "created_at", "updated_at") SELECT "id", "email", "password_hash", "role", "full_name", "phone", "is_active", "failed_logins", "locked_until", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- ===== Manual: libro de movimientos inmutable =====
CREATE TRIGGER `movements_no_update` BEFORE UPDATE ON `inventory_movements`
  BEGIN SELECT RAISE(ABORT, 'inventory_movements es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `movements_no_delete` BEFORE DELETE ON `inventory_movements`
  BEGIN SELECT RAISE(ABORT, 'inventory_movements es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `counts_no_update` BEFORE UPDATE ON `physical_counts`
  BEGIN SELECT RAISE(ABORT, 'physical_counts es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `counts_no_delete` BEFORE DELETE ON `physical_counts`
  BEGIN SELECT RAISE(ABORT, 'physical_counts es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `cuts_no_delete` BEFORE DELETE ON `cuts`
  BEGIN SELECT RAISE(ABORT, 'cuts no se borra: registra un ajuste'); END;
--> statement-breakpoint
-- Un corte solo se modifica para conciliarlo una vez (o, en la Fase 3, vincularlo a un pedido).
CREATE TRIGGER `cuts_reconcile_once` BEFORE UPDATE ON `cuts`
  WHEN OLD.`unit_id` <> NEW.`unit_id` OR OLD.`method` <> NEW.`method`
    OR OLD.`cut_area_mm2` <> NEW.`cut_area_mm2` OR OLD.`used_area_mm2` <> NEW.`used_area_mm2`
    OR OLD.`remnant_area_mm2` <> NEW.`remnant_area_mm2` OR OLD.`waste_area_mm2` <> NEW.`waste_area_mm2`
    OR OLD.`user_id` <> NEW.`user_id` OR OLD.`created_at` <> NEW.`created_at`
    OR (OLD.`reconciled_count_id` IS NOT NULL AND NEW.`reconciled_count_id` IS NOT OLD.`reconciled_count_id`)
  BEGIN SELECT RAISE(ABORT, 'cuts: solo se puede conciliar una vez'); END;
--> statement-breakpoint
-- ===== Manual: tallas iniciales de corte a pulso (el admin las ajusta) =====
INSERT INTO `freehand_sizes` (`name`, `ref_area_mm2`, `sort_order`) VALUES
  ('Pequeño (≈ 10 × 50 cm)', 50000, 10),
  ('Mediano (≈ 50 × 50 cm)', 250000, 20),
  ('Grande (≈ 1 × 1 m)', 1000000, 30);
