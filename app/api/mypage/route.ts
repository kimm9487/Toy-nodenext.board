import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// 내가 쓴 게시물 한 행 (DB 결과)
type PostRow = RowDataPacket & {
  id: number;
  title: string;
  view_count: number;
  reply_count: number;
  created_at: Date;
  is_notice: number;
};

// 내가 댓글을 단 게시물 한 행 (DB 결과)
type CommentedRow = RowDataPacket & {
  id: number;
  title: string;
  author: string;       // 원글 작성자
  view_count: number;
  my_comment_count: number; // 해당 게시물에 내가 단 댓글 수
  created_at: Date;
};

// 내가 쓴 게시글과 내가 쓴 댓글이나 대댓글의 게시글 보여주기
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  // URL에서 type 파라미터 기본값은 posts
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "posts";

  if (type === "posts") {
    // 내가 작성한 최상위 게시물 목록 desc 조회 
    const [rows] = await pool.execute<PostRow[]>(
      `SELECT
         p.id,
         p.title,
         p.view_count,
         p.is_notice,
         p.created_at,
         (SELECT COUNT(*) FROM board_posts r
          WHERE r.thread_id = p.id AND r.id <> p.id AND r.is_deleted = 0) AS reply_count
       FROM board_posts p
       WHERE p.user_id = :userId
         AND p.parent_id IS NULL
         AND p.is_deleted = 0
       ORDER BY p.created_at DESC`,
      { userId: user.id }
    );

    return NextResponse.json({
      posts: rows.map((r) => ({
        id: r.id,
        title: r.title,
        viewCount: r.view_count,
        replyCount: Number(r.reply_count),
        createdAt: r.created_at.toISOString(),
        isNotice: r.is_notice === 1
      }))
    });
  }

  // 이너 조인으로 내 댓글이 달린 게시물만 가져오고 그룹 바이로 게시물당 내 댓글 수를 센다.
  const [rows] = await pool.execute<CommentedRow[]>(
    `SELECT
       p.id,
       p.title,
       p.author,
       p.view_count,
       p.created_at,
       COUNT(c.id) AS my_comment_count
     FROM board_posts p
     INNER JOIN board_posts c
       ON c.thread_id = p.id
       AND c.parent_id IS NOT NULL
       AND c.user_id = :userId
       AND c.is_deleted = 0
     WHERE p.parent_id IS NULL
       AND p.is_deleted = 0
     GROUP BY p.id, p.title, p.author, p.view_count, p.created_at
     ORDER BY p.created_at DESC`,
    { userId: user.id }
  );

  return NextResponse.json({
    posts: rows.map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author,
      viewCount: r.view_count,
      myCommentCount: Number(r.my_comment_count),
      createdAt: r.created_at.toISOString()
    }))
  });
}
