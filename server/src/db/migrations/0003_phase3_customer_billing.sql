PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_customers` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer,
	`full_name` text NOT NULL,
	`phone` text,
	`email` text,
	`document_type` text,
	`document_number` text,
	`nit_check_digit` integer,
	`billing_email` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customers_doc_type_check" CHECK("__new_customers"."document_type" IS NULL OR "__new_customers"."document_type" IN ('CC','NIT','CE','PASAPORTE','OTRO')),
	CONSTRAINT "customers_nit_dv_check" CHECK("__new_customers"."nit_check_digit" IS NULL OR ("__new_customers"."nit_check_digit" BETWEEN 0 AND 9 AND "__new_customers"."document_type" = 'NIT'))
);
--> statement-breakpoint
INSERT INTO `__new_customers`("id", "user_id", "full_name", "phone", "email", "document_type", "document_number", "nit_check_digit", "billing_email", "notes", "created_at") SELECT "id", "user_id", "full_name", "phone", "email", NULL, NULL, NULL, NULL, "notes", "created_at" FROM `customers`;--> statement-breakpoint
DROP TABLE `customers`;--> statement-breakpoint
ALTER TABLE `__new_customers` RENAME TO `customers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_user_unique` ON `customers` (`user_id`);