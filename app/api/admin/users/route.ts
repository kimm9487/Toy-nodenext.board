import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

type UserRow = RowDataPacket & {
  id: number;
  username: string;
  display_name: string;
  is_banned: number;     // 0: 정상, 1: 차단
  created_at: Date;
  post_count: number;    // 작성한 게시글 수
  comment_count: number; // 작성한 댓글 수
};

// 회원 목록을 반환
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  // 각 회원의 게시글 댓글 수를 계산해 활동량 기준으로 오더바이 desc 정렬
  const [rows] = await pool.query<UserRow[]>(`
    SELECT
      u.id,
      u.username,
      u.display_name,
      u.is_banned,
      u.created_at,
      (SELECT COUNT(*) FROM board_posts
       WHERE user_id = u.id AND parent_id IS NULL AND is_deleted = 0) AS post_count,
      (SELECT COUNT(*) FROM board_posts
       WHERE user_id = u.id AND parent_id IS NOT NULL AND is_deleted = 0) AS comment_count
    FROM users u
    ORDER BY (post_count + comment_count) DESC, u.created_at DESC
    LIMIT 100
  `);

  return NextResponse.json({
    users: rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      postCount: Number(r.post_count),
      commentCount: Number(r.comment_count),
      isBanned: r.is_banned === 1,
      createdAt: r.created_at.toISOString()
    }))
  });
}
