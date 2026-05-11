import { NextResponse } from "next/server";
import { ResultSetHeader } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// 금칙어삭제
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ message: "올바른 번호가 아닙니다." }, { status: 400 });
  }

  // blocked_words 테이블에서 삭제 쿼리
  await pool.execute<ResultSetHeader>("DELETE FROM blocked_words WHERE id = :id", { id });
  return NextResponse.json({ ok: true });
}
