import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { createSessionId, getRequestIp, getSessionCookieName, getUserAgent, verifyPassword } from "@/lib/auth";
import { pool } from "@/lib/db";

// DB의 users 테이블 조회 행 구조
type UserRow = RowDataPacket & {
  id: number;
  username: string;
  display_name: string;
  password_hash: string; 
  is_banned: number;     
};

// 로그인 성공 시 사용자 정보를 반환하고 7일짜리 세션 쿠키 발급
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");

  if (!username || !password) {
    return NextResponse.json({ message: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  // DB에서 해당 아이디 조회 후 차단 여부 확인
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT id, username, display_name, password_hash, is_banned FROM users WHERE username = :username",
    { username }
  );
  const user = rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  if (user.is_banned) {
    return NextResponse.json({ message: "차단된 계정입니다. 관리자에게 문의하세요." }, { status: 403 });
  }

  // 로그인 성공시 새 세션 아이디를 만들고 DB의 유저세션 테이블에 기록
  const sessionId = createSessionId();
  await pool.execute(
    `INSERT INTO user_sessions
       (session_id, user_id, username, display_name, ip_address, user_agent, login_at, last_activity_at)
     VALUES
       (:sessionId, :userId, :username, :displayName, :ipAddress, :userAgent, NOW(), NOW())`,
    {
      sessionId,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      ipAddress: getRequestIp(), // 접속 IP 기록
      userAgent: getUserAgent()  // 브라우저 정보 기록
    }
  );

  const response = NextResponse.json({
    user: { id: user.id, username: user.username, displayName: user.display_name }
  });

  response.cookies.set(getSessionCookieName(), sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}
