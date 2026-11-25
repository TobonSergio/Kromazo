CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY NOT NULL,
	`quote_request_id` integer,
	`order_id` integer,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width_px` integer NOT NULL,
	`height_px` integer NOT NULL,
	`uploaded_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachments_mime_check" CHECK("attachments"."mime_type" = 'image/jpeg'),
	CONSTRAINT "attachments_owner_check" CHECK("attachments"."quote_request_id" IS NOT NULL OR "attachments"."order_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_key_unique` ON `attachments` (`storage_key`);--> statement-breakpoint
CREATE INDEX `attachments_request_idx` ON `attachments` (`quote_request_id`);--> statement-breakpoint
CREATE INDEX `attachments_order_idx` ON `attachments` (`order_id`);--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`pricing_unit` text NOT NULL,
	`unit_price` integer NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`material_id` integer,
	`is_public` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "catalog_kind_check" CHECK("catalog_items"."kind" IN ('PRODUCTO','SERVICIO')),
	CONSTRAINT "catalog_unit_check" CHECK("catalog_items"."pricing_unit" IN ('UNIDAD','METRO_LINEAL','M2','GLOBAL')),
	CONSTRAINT "catalog_price_check" CHECK("catalog_items"."unit_price" >= 0),
	CONSTRAINT "catalog_tax_check" CHECK("catalog_items"."tax_rate_bp" IN (0, 500, 1900))
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY NOT NULL,
	`order_id` integer NOT NULL,
	`catalog_item_id` integer,
	`description` text NOT NULL,
	`pricing_unit` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_item_id`) REFERENCES `catalog_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_items_qty_check" CHECK("order_items"."quantity_milli" > 0),
	CONSTRAINT "order_items_price_check" CHECK("order_items"."unit_price" >= 0 AND "order_items"."discount" >= 0 AND "order_items"."line_total" >= 0),
	CONSTRAINT "order_items_tax_check" CHECK("order_items"."tax_rate_bp" IN (0, 500, 1900) AND "order_items"."tax_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` integer PRIMARY KEY NOT NULL,
	`order_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_history_order_idx` ON `order_status_history` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`customer_id` integer NOT NULL,
	`quote_request_id` integer,
	`status` text NOT NULL,
	`vehicle_desc` text,
	`description` text,
	`internal_notes` text,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`discount` integer DEFAULT 0 NOT NULL,
	`tax_total` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`invoice_number` text,
	`invoice_cufe` text,
	`quote_valid_until` text,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" IN ('COTIZADO','APROBADO','EN_PROCESO','TERMINADO','ENTREGADO','CANCELADO')),
	CONSTRAINT "orders_totals_check" CHECK("orders"."total" = "orders"."subtotal" + "orders"."tax_total" AND "orders"."subtotal" >= 0 AND "orders"."tax_total" >= 0 AND "orders"."discount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_code_unique` ON `orders` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_quote_request_unique` ON `orders` (`quote_request_id`);--> statement-breakpoint
CREATE INDEX `orders_customer_status_idx` ON `orders` (`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY NOT NULL,
	`order_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_check" CHECK("payments"."amount" > 0),
	CONSTRAINT "payments_method_check" CHECK("payments"."method" IN ('EFECTIVO','TRANSFERENCIA','TARJETA','OTRO'))
);
--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE TABLE `quote_requests` (
	`id` integer PRIMARY KEY NOT NULL,
	`customer_id` integer NOT NULL,
	`status` text DEFAULT 'NUEVA' NOT NULL,
	`vehicle_desc` text NOT NULL,
	`description` text NOT NULL,
	`discard_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quote_requests_status_check" CHECK("quote_requests"."status" IN ('NUEVA','COTIZADA','DESCARTADA'))
);
--> statement-breakpoint
CREATE INDEX `quote_requests_status_idx` ON `quote_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `quote_requests_customer_idx` ON `quote_requests` (`customer_id`);--> statement-breakpoint
ALTER TABLE `cuts` ADD `order_id` integer REFERENCES orders(id);--> statement-breakpoint
ALTER TABLE `customers` DROP COLUMN `document_id`;