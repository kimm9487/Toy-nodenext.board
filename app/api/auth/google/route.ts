import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { createSessionId, getRequestIp, getSessionCookieName, getUserAgent } from "@/lib/auth";
import { pool } from "@/lib/db";

// 이 앱의 구글 OAuth 클라이언트 ID (구글 클라우드 콘솔에서 발급)
const GOOGLE_CLIENT_ID = "438630186064-m189lup864er9nbpr8e9tbtkfo6i9skj.apps.googleusercontent.com";

type GoogleTokenInfo = {
  sub?: string;   // 구글 계정의 고유 ID
  email?: string;
  name?: string;
  aud?: string;   // 토큰이 발급된 클라이언트 ID (우리 앱 ID와 일치해야 함)
  error?: string;
};

// DB users 테이블에서 조회한 행
type UserRow = RowDataPacket & {
  id: number;
  username: string;
  display_name: string;
  is_banned: number;
};

// 구글 서버에 토큰 검증 요청
// 검증 성공 시 기존 계정(google_id로 연결)을 찾거나 없으면 자동 생성
// 세션을 발급하고 로그인 쿠키를 설정
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const credential = String(body?.credential ?? "");

  if (!credential) {
    return NextResponse.json({ message: "인증 정보가 없습니다." }, { status: 400 });
  }

  // 구글 tokeninfo 엔드포인트에 토큰을 보내 유효성 검증
  const tokenInfo: GoogleTokenInfo = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  )
    .then((r) => r.json())
    .catch(() => ({ error: "fetch_failed" }));

  // aud가 우리 앱의 클라이언트 ID와 다르면 다른 앱용 토큰이므로 거부
  if (tokenInfo.error || tokenInfo.aud !== GOOGLE_CLIENT_ID || !tokenInfo.sub || !tokenInfo.email) {
    return NextResponse.json({ message: "Google 인증에 실패했습니다." }, { status: 401 });
  }

  const googleId = tokenInfo.sub;   // 구글 고유 ID (변경되지 않음)
  const email = tokenInfo.email;
  const displayName = (tokenInfo.name || email.split("@")[0]).slice(0, 50);

  // google_id로 기존 회원 찾기
  const [byGoogle] = await pool.execute<UserRow[]>(
    "SELECT id, username, display_name, is_banned FROM users WHERE google_id = :googleId",
    { googleId }
  );

  let userId: number;
  let username: string;
  let userDisplayName: string;

  if (byGoogle[0]) {
    // 기존 구글 연동 계정이 있는 경우 차단 여부 확인 후 로그인
    if (byGoogle[0].is_banned) {
      return NextResponse.json({ message: "차단된 계정입니다. 관리자에게 문의하세요." }, { status: 403 });
    }
    userId = byGoogle[0].id;
    username = byGoogle[0].username;
    userDisplayName = byGoogle[0].display_name;
  } else {
    // 처음 구글 로그인하는 경우 이메일 앞부분을 기반으로 아이디를 자동 생성한다.
    const base = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "_").slice(0, 25) || "user";
    let candidate = base;
    let suffix = 2;
    // 같은 아이디가 이미 있으면 숫자를 붙여 고유 생성
    for (;;) {
      const [dup] = await pool.execute<UserRow[]>(
        "SELECT id FROM users WHERE username = :username",
        { username: candidate }
      );
      if (!dup[0]) break;
      candidate = `${base}${suffix++}`;
    }

    // 새 계정을 생성 비밀번호 해쉬는 빈 문자열 (구글 로그인 전용 계정)
    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (username, display_name, password_hash, google_id)
       VALUES (:username, :displayName, '', :googleId)`,
      { username: candidate, displayName, googleId }
    );
    userId = ins.insertId;
    username = candidate;
    userDisplayName = displayName;
  }

  // 세션을 생성하고 7일짜리 로그인 쿠키를 발급
  const sessionId = createSessionId();
  await pool.execute(
    `INSERT INTO user_sessions
       (session_id, user_id, username, display_name, ip_address, user_agent, login_at, last_activity_at)
     VALUES
       (:sessionId, :userId, :username, :displayName, :ipAddress, :userAgent, NOW(), NOW())`,
    {
      sessionId,
      userId,
      username,
      displayName: userDisplayName,
      ipAddress: getRequestIp(),
      userAgent: getUserAgent()
    }
  );

  const response = NextResponse.json({
    user: { id: userId, username, displayName: userDisplayName }
  });

  response.cookies.set(getSessionCookieName(), sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}
