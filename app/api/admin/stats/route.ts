import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";

//관리자만 가능
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  // 오늘 게시글 댓글 가입 수 전체 회원 게시글 수 쿼리
  const [[kpi]] = await pool.query<RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM board_posts
       WHERE parent_id IS NULL AND DATE(created_at) = CURDATE() AND is_deleted = 0) AS todayPosts,
      (SELECT COUNT(*) FROM board_posts
       WHERE parent_id IS NOT NULL AND DATE(created_at) = CURDATE() AND is_deleted = 0) AS todayComments,
      (SELECT COUNT(*) FROM users WHERE DATE(created_at) = CURDATE()) AS todaySignups,
      (SELECT COUNT(*) FROM users WHERE is_banned = 0) AS totalUsers,
      (SELECT COUNT(*) FROM board_posts WHERE parent_id IS NULL AND is_deleted = 0) AS totalPosts
  `);

  // 14일간 일별 로그인 세션 수 쿼리
  const [trafficRows] = await pool.query<RowDataPacket[]>(`
    SELECT DATE(login_at) AS date, COUNT(*) AS count
    FROM user_sessions
    WHERE login_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
    GROUP BY DATE(login_at)
    ORDER BY date ASC
  `);

  // 최근 30일간 모바일/PC 접속 수 쿼리
  const [[deviceRow]] = await pool.query<RowDataPacket[]>(`
    SELECT
      SUM(CASE WHEN user_agent REGEXP '(Mobile|Android|iPhone|iPad|iPod|webOS)' THEN 1 ELSE 0 END) AS mobile,
      SUM(CASE WHEN user_agent NOT REGEXP '(Mobile|Android|iPhone|iPad|iPod|webOS)' THEN 1 ELSE 0 END) AS pc
    FROM user_sessions
    WHERE login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  `);

  // 데이터가 없어도 0으로 채움
  const last14: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last14.push(d.toISOString().slice(0, 10));
  }

  const trafficMap = new Map<string, number>();
  for (const row of trafficRows) {
    const key = new Date(row.date).toISOString().slice(0, 10);
    trafficMap.set(key, Number(row.count));
  }

  return NextResponse.json({
    kpi: {
      todayPosts: Number(kpi.todayPosts),
      todayComments: Number(kpi.todayComments),
      todaySignups: Number(kpi.todaySignups),
      totalUsers: Number(kpi.totalUsers),
      totalPosts: Number(kpi.totalPosts)
    },
    
    traffic: last14.map((date) => ({ date, count: trafficMap.get(date) ?? 0 })),
    devices: {
      mobile: Number(deviceRow?.mobile ?? 0),
      pc: Number(deviceRow?.pc ?? 0)
    }
  });
}
