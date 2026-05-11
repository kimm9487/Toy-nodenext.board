import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// DB board_posts 한 행 (관리자 목록용)
type PostRow = RowDataPacket & {
  id: number;
  title: string;
  author: string;
  view_count: number;
  reply_count: number;
  created_at: Date;
  is_notice: number;
};

// DB reports 한 행 (신고 목록용)
type ReportRow = RowDataPacket & {
  id: number;
  post_id: number;
  post_title: string;    // JOIN으로 가져온 게시물 제목
  reporter_name: string; // JOIN으로 가져온 신고자 닉네임
  reason: string;
  created_at: Date;
};

// 관리자 게시물 현황 데이터를 반환한다.
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  // 최신 게시글 10개 조회
  const [latest] = await pool.query<PostRow[]>(`
    SELECT
      p.id, p.title, p.author, p.view_count, p.is_notice, p.created_at,
      (SELECT COUNT(*) FROM board_posts r
       WHERE r.thread_id = p.id AND r.id <> p.id AND r.is_deleted = 0) AS reply_count
    FROM board_posts p
    WHERE p.parent_id IS NULL AND p.is_deleted = 0
    ORDER BY p.created_at DESC
    LIMIT 10
  `);

  // 조회수 기준 인기 게시글 5개 조회
  const [popular] = await pool.query<PostRow[]>(`
    SELECT
      p.id, p.title, p.author, p.view_count, p.is_notice, p.created_at,
      (SELECT COUNT(*) FROM board_posts r
       WHERE r.thread_id = p.id AND r.id <> p.id AND r.is_deleted = 0) AS reply_count
    FROM board_posts p
    WHERE p.parent_id IS NULL AND p.is_deleted = 0
    ORDER BY p.view_count DESC
    LIMIT 5
  `);

  // 처리되지 않은(is_resolved=0) 신고 목록 20개 조회
  const [reports] = await pool.query<ReportRow[]>(`
    SELECT r.id, r.post_id, r.reason, r.created_at,
           p.title AS post_title,
           u.display_name AS reporter_name
    FROM reports r
    JOIN board_posts p ON p.id = r.post_id
    JOIN users u ON u.id = r.reporter_id
    WHERE r.is_resolved = 0
    ORDER BY r.created_at DESC
    LIMIT 20
  `);

  // DB 스네이크 케이스 > 카멜 케이스로 변환 헬퍼
  const mapPost = (r: PostRow) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    viewCount: r.view_count,
    replyCount: Number(r.reply_count),
    createdAt: r.created_at.toISOString(),
    isNotice: r.is_notice === 1
  });

  return NextResponse.json({
    latest: latest.map(mapPost),
    popular: popular.map(mapPost),
    reports: reports.map((r) => ({
      id: r.id,
      postId: r.post_id,
      postTitle: r.post_title,
      reporterName: r.reporter_name,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
      isResolved: false
    }))
  });
}
