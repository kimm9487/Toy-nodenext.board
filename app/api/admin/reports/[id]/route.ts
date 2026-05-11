// 게시물 삭제 여부와 무관하게 신고 건을 처리 완료로 표시하는 데 사용한다.
import { NextResponse } from "next/server";
import { ResultSetHeader } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// 신고를 처리 완료로 표시한다.
// 신고 승인 또는 반려
export async function PATCH(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "올바른 번호가 아닙니다." }, { status: 400 });
  }

  // is_resolved=1로 표시하고 처리 시각을 기록
  await pool.execute<ResultSetHeader>(
    "UPDATE reports SET is_resolved = 1, resolved_at = NOW() WHERE id = :id",
    { id }
  );

  return NextResponse.json({ ok: true });
}
