import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

// 대상 회원의 아이디를 확인하기 위한 최소한의 행 타입
type UserRow = RowDataPacket & { username: string };

// 회원 차단, 차단 해제를 처리한다.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await getCurrentUser();
  if (!admin || admin.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const targetId = Number(params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ message: "올바른 회원 번호가 아닙니다." }, { status: 400 });
  }

  //타겟유저 찾기
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT username FROM users WHERE id = :id",
    { id: targetId }
  );
  const target = rows[0];
  if (!target) {
    return NextResponse.json({ message: "회원을 찾을 수 없습니다." }, { status: 404 });
  }
  // 관리자 계정 변경 불가 락 걸어두기
  if (target.username === "admin") {
    return NextResponse.json({ message: "관리자 계정은 변경할 수 없습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const banned = Boolean(body?.banned);

  // is_banned 플래그를 업데이트하고 차단 시간 기록
  await pool.execute<ResultSetHeader>(
    `UPDATE users SET is_banned = :banned, banned_at = ${banned ? "NOW()" : "NULL"} WHERE id = :id`,
    { banned: banned ? 1 : 0, id: targetId }
  );

  // 차단 시에는 현재 활성 세션을 모두 강제 로그아웃
  if (banned) {
    await pool.execute(
      "UPDATE user_sessions SET is_active = 0, logout_at = NOW() WHERE user_id = :id AND is_active = 1",
      { id: targetId }
    );
  }

  return NextResponse.json({ ok: true });
}
