CREATE TABLE `purchase_lines` (
	`id` integer PRIMARY KEY NOT NULL,
	`purchase_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`rolls` integer NOT NULL,
	`width_mm` integer NOT NULL,
	`length_mm` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_lines_check" CHECK("purchase_lines"."rolls" > 0 AND "purchase_lines"."width_mm" > 0 AND "purchase_lines"."length_mm" > 0 AND "purchase_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE INDEX `purchase_lines_purchase_idx` ON `purchase_lines` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` integer PRIMARY KEY NOT NULL,
	`supplier_id` integer NOT NULL,
	`invoice_ref` text,
	`purchased_at` text NOT NULL,
	`total` integer NOT NULL,
	`notes` text,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchases_total_check" CHECK("purchases"."total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `purchases_date_idx` ON `purchases` (`purchased_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `inventory_units` ADD `purchase_line_id` integer REFERENCES purchase_lines(id);--> statement-breakpoint
-- ===== Manual: una compra confirmada no se modifica ni se borra (se corrige con ajustes) =====
CREATE TRIGGER `purchases_no_update` BEFORE UPDATE ON `purchases`
  BEGIN SELECT RAISE(ABORT, 'purchases es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `purchases_no_delete` BEFORE DELETE ON `purchases`
  BEGIN SELECT RAISE(ABORT, 'purchases es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_lines_no_update` BEFORE UPDATE ON `purchase_lines`
  BEGIN SELECT RAISE(ABORT, 'purchase_lines es inmutable'); END;
--> statement-breakpoint
CREATE TRIGGER `purchase_lines_no_delete` BEFORE DELETE ON `purchase_lines`
  BEGIN SELECT RAISE(ABORT, 'purchase_lines es inmutable'); END;
