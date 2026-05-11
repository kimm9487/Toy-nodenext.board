CREATE DATABASE IF NOT EXISTS `node_board`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `node_board`;


CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(30) NOT NULL,
  `display_name` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `session_id` VARCHAR(128) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `username` VARCHAR(30) NOT NULL,
  `display_name` VARCHAR(50) NOT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `user_agent` VARCHAR(255) NOT NULL,
  `login_at` DATETIME NOT NULL,
  `last_activity_at` DATETIME NOT NULL,
  `logout_at` DATETIME NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`session_id`),
  KEY `idx_user_sessions_user_id` (`user_id`),
  KEY `idx_user_sessions_active` (`is_active`, `last_activity_at`),
  CONSTRAINT `fk_user_sessions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `board_posts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `parent_id` INT UNSIGNED NULL,
  `thread_id` INT UNSIGNED NULL,
  `depth` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `author` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL DEFAULT '',
  `title` VARCHAR(200) NOT NULL,
  `content` TEXT NOT NULL,
  `view_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_board_posts_user_id` (`user_id`),
  KEY `idx_board_posts_parent_id` (`parent_id`),
  KEY `idx_board_posts_thread_id` (`thread_id`),
  KEY `idx_board_posts_list` (`thread_id`, `parent_id`, `created_at`),
  CONSTRAINT `fk_board_posts_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT,
  CONSTRAINT `fk_board_posts_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `board_posts` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attachments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `byte_size` INT UNSIGNED NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attachments_post_id` (`post_id`),
  CONSTRAINT `fk_attachments_post`
    FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_attachments_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `comment_likes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comment_likes_post_user` (`post_id`, `user_id`),
  KEY `idx_comment_likes_post_id` (`post_id`),
  KEY `idx_comment_likes_user_id` (`user_id`),
  CONSTRAINT `fk_comment_likes_post`
    FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_comment_likes_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `users` (`username`, `display_name`, `password_hash`)
SELECT
  'admin',
  CONVERT(0xEAB480EBA6ACEC9E90 USING utf8mb4),
  '$2y$10$1qY4yItBjR6HafeuDOruKexF31CaeXMSggICxVXmZe4sFYu59MzxK'
WHERE NOT EXISTS (SELECT 1 FROM `users` WHERE `username` = 'admin');

INSERT INTO `board_posts`
  (`user_id`, `parent_id`, `thread_id`, `depth`, `author`, `password_hash`, `title`, `content`, `created_at`)
SELECT
  (SELECT `id` FROM `users` WHERE `username` = 'admin' LIMIT 1),
  NULL,
  NULL,
  0,
  CONVERT(0xEAB480EBA6ACEC9E90 USING utf8mb4),
  '',
  CONVERT(0xEB8BB5EBB380ED989520EAB28CEC8B9CED8C90EC9D8420EC8B9CEC9E91ED95A9EB8B88EB8BA4 USING utf8mb4),
  CONVERT(0xECB2AB20EBB288ECA7B820EC8398ED948C20EAB880EC9E85EB8B88EB8BA42E20EBB984EBB080EBB288ED98B8EB8A94203132333420EC9E85EB8B88EB8BA42E USING utf8mb4),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM `board_posts`);

UPDATE `board_posts`
SET `thread_id` = `id`
WHERE `thread_id` IS NULL;
