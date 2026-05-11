import { NextResponse } from "next/server";
import { ResultSetHeader } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";
import { saveAttachments, validateImageFiles } from "@/lib/attachments";

// 공지사항을 작성
// 이미지 첨부가 있으면 multipart/form-data, 없으면 JSON으로 요청이 들어온다.
export async function POST(request: Request) {
  // 관리자 인증 확인
  const user = await getCurrentUser();
  if (!user || user.username !== "admin") {
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let title = "";
  let content = "";
  let images: File[] = [];

  // Content-Type에 따라 파싱 방식 분기
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    title = String(form.get("title") ?? "").trim();
    content = String(form.get("content") ?? "").trim();
    images = form.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
  } else {
    const body = await request.json().catch(() => null);
    title = String(body?.title ?? "").trim();
    content = String(body?.content ?? "").trim();
  }

  if (!title || !content) {
    return NextResponse.json({ message: "제목과 내용을 입력해주세요." }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ message: "제목이 너무 깁니다." }, { status: 400 });
  }

  const validation = validateImageFiles(images);
  if (!validation.ok) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  // is_notice=1로 설정해 공지글표시
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO board_posts
       (user_id, parent_id, thread_id, depth, author, password_hash, title, content, is_notice)
     VALUES
       (:userId, NULL, NULL, 0, :author, '', :title, :content, 1)`,
    { userId: user.id, author: user.displayName, title, content }
  );

  // thread_id를 자기 자신의 id로 설정
  await pool.execute(
    "UPDATE board_posts SET thread_id = :id WHERE id = :id",
    { id: result.insertId }
  );

  await saveAttachments(result.insertId, user.id, validation.files);

  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
