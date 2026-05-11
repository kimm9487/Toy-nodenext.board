import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { createSessionId, getRequestIp, getSessionCookieName, getUserAgent, hashPassword } from "@/lib/auth";
import { pool } from "@/lib/db";

// 중복 아이디 확인 쿼리 결과 타입
type UserRow = RowDataPacket & {
  count: number;
};

// 회원가입 성공 시 사용자를 DB에 저장하고 로그인과 동일하게 세션 쿠키를 발급
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username ?? "").trim();
  const displayName = String(body?.displayName ?? "").trim();
  const password = String(body?.password ?? "");

  // 아이디 형식 검사
  if (!/^[a-zA-Z0-9_]{4,30}$/.test(username)) {
    return NextResponse.json({ message: "아이디는 영문, 숫자, 밑줄 4~30자로 입력해주세요." }, { status: 400 });
  }

  // 닉네임 길이 검사
  if (!displayName || displayName.length > 50) {
    return NextResponse.json({ message: "닉네임은 1~50자로 입력해주세요." }, { status: 400 });
  }

  // 비밀번호 길이 검사
  if (password.length < 6 || password.length > 13) {
    return NextResponse.json({ message: "비밀번호는 6~13자로 입력해주세요." }, { status: 400 });
  }

  // 아이디 중복 확인
  const [existingRows] = await pool.execute<UserRow[]>(
    "SELECT COUNT(*) AS count FROM users WHERE username = :username",
    { username }
  );

  if (existingRows[0]?.count > 0) {
    return NextResponse.json({ message: "이미 사용 중인 아이디입니다." }, { status: 409 });
  }

  // 비밀번호 해쉬만들어서 저장
  const passwordHash = hashPassword(password);
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO users (username, display_name, password_hash) VALUES (:username, :displayName, :passwordHash)",
    { username, displayName, passwordHash }
  );

  // 회원가입후 바로 로그인 세션 바로 만들어주기
  const sessionId = createSessionId();
  await pool.execute(
    `INSERT INTO user_sessions
       (session_id, user_id, username, display_name, ip_address, user_agent, login_at, last_activity_at)
     VALUES
       (:sessionId, :userId, :username, :displayName, :ipAddress, :userAgent, NOW(), NOW())`,
    {
      sessionId,
      userId: result.insertId, 
      username,
      displayName,
      ipAddress: getRequestIp(),
      userAgent: getUserAgent()
    }
  );

  const response = NextResponse.json({
    user: { id: result.insertId, username, displayName }
  });

  response.cookies.set(getSessionCookieName(), sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}
