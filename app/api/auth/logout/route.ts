import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCookieName } from "@/lib/auth";
import { pool } from "@/lib/db";

// 로그아웃 요청 처리
export async function POST() {
  const sessionId = cookies().get(getSessionCookieName())?.value;

  if (sessionId) {
    // DB에서 해당 세션을 비활성화하고 로그아웃 시각을 기록
    // 실제 행을 삭제하지 않고 is_active=0으로 표시해 로그인 기록 보존
    await pool.execute(
      "UPDATE user_sessions SET is_active = 0, logout_at = NOW() WHERE session_id = :sessionId",
      { sessionId }
    );
  }

  const response = NextResponse.json({ ok: true });

  // 쿠키 값 빈 문자열로 바꾸고 브라우저에서 쿠키삭제
  response.cookies.set(getSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });

  return response;
}
