import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// 세션 쿠키를 보고 로그인 여부와 사용자 정보를 가져온다
export async function GET() {
  
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
