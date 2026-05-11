import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// 신고를 접수하고 reports 테이블에 저장한다.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const postId = Number(body?.postId);
  // 500자 제한
  const reason = String(body?.reason ?? "").trim().slice(0, 500);

  // 신고 대상 ID가 유효한지 확인
  if (!Number.isInteger(postId) || postId <= 0) {
    return NextResponse.json({ message: "올바른 게시물 번호가 아닙니다." }, { status: 400 });
  }

  // 신고 대상 게시물이 존재 확인
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM board_posts WHERE id = :postId AND is_deleted = 0",
    { postId }
  );
  if (!rows[0]) {
    return NextResponse.json({ message: "게시물을 찾을 수 없습니다." }, { status: 404 });
  }

  // 신고를 reports 테이블에 저장한다.
  await pool.execute<ResultSetHeader>(
    "INSERT INTO reports (reporter_id, post_id, reason) VALUES (:reporterId, :postId, :reason)",
    { reporterId: user.id, postId, reason }
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
