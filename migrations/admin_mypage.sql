-- 회원 차단 컬럼
ALTER TABLE `users`
  ADD COLUMN `is_banned` TINYINT(1) NOT NULL DEFAULT 0 AFTER `password_hash`,
  ADD COLUMN `banned_at` DATETIME NULL AFTER `is_banned`;

-- 게시물 공지 컬럼
ALTER TABLE `board_posts`
  ADD COLUMN `is_notice` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_deleted`;

-- 신고 테이블
CREATE TABLE IF NOT EXISTS `reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reporter_id` INT UNSIGNED NOT NULL,
  `post_id` INT UNSIGNED NOT NULL,
  `reason` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_resolved` TINYINT(1) NOT NULL DEFAULT 0,
  `resolved_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reports_post_id` (`post_id`),
  KEY `idx_reports_resolved` (`is_resolved`, `created_at`),
  CONSTRAINT `fk_reports_post` FOREIGN KEY (`post_id`) REFERENCES `board_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reports_reporter` FOREIGN KEY (`reporter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 금칙어 테이블
CREATE TABLE IF NOT EXISTS `blocked_words` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `word` VARCHAR(100) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_blocked_word` (`word`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
