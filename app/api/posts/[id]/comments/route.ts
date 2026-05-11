import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";
import { saveAttachments, validateImageFiles } from "@/lib/attachments";
import { filterBlockedWords } from "@/lib/filter";

type ParentRow = RowDataPacket & {
  id: number;
  thread_id: number | null;
  depth: number;     
  is_deleted: number;
};

// 댓글과 대댓글 작성
export async function POST(request: Request, { params }: { params: { id: string } }) {
  // 비로그인 작성 불가
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  const threadId = Number(params.id);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return NextResponse.json({ message: "올바른 게시물 번호가 아닙니다." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let content = "";
  let parentIdRaw: unknown = null; // 어느 댓글에 답글을 달지 (null이면 게시물에 직접)
  let images: File[] = [];

  // 이미지 포함 여부에 따라 파싱 방식 분기
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    content = String(form.get("content") ?? "").trim();
    parentIdRaw = form.get("parentId");
    images = form.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
  } else {
    const body = await request.json().catch(() => null);
    content = String(body?.content ?? "").trim();
    parentIdRaw = body?.parentId;
  }

  // parentId가 없거나 빈 값이면 null로 처리 (게시물에 직접 달리는 댓글)
  const parentId =
    parentIdRaw === null || parentIdRaw === undefined || parentIdRaw === ""
      ? null
      : Number(parentIdRaw);

  // 내용과 이미지 둘 다 없으면 오류 반환 (이미지만 있어도 댓글로 허용)
  if (!content && images.length === 0) {
    return NextResponse.json({ message: "댓글 내용 또는 이미지를 입력해주세요." }, { status: 400 });
  }

  // 이미지 형식 크기 유효성 검사
  const validation = validateImageFiles(images);
  if (!validation.ok) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  // 대상 게시물이 존재하고 삭제 되지 않았는지 확인
  const [threadRows] = await pool.execute<ParentRow[]>(
    `SELECT id, thread_id, depth, is_deleted
     FROM board_posts
     WHERE id = :threadId AND parent_id IS NULL`,
    { threadId }
  );

  if (!threadRows[0] || threadRows[0].is_deleted === 1) {
    return NextResponse.json({ message: "게시물을 찾을 수 없습니다." }, { status: 404 });
  }

  let resolvedParentId = threadId; // parentId가 없으면 게시물 자체가 부모
  let parentDepth = 0;

  if (parentId !== null) {
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return NextResponse.json({ message: "올바른 부모 댓글 번호가 아닙니다." }, { status: 400 });
    }

    // 부모 댓글이 같은 스레드 안에 있는지 확인 (다른 게시물 댓글에 답글 불가)
    const [parentRows] = await pool.execute<ParentRow[]>(
      `SELECT id, thread_id, depth, is_deleted
       FROM board_posts
       WHERE id = :parentId AND thread_id = :threadId`,
      { parentId, threadId }
    );

    const parent = parentRows[0];
    if (!parent || parent.is_deleted === 1) {
      return NextResponse.json({ message: "부모 댓글을 찾을 수 없습니다." }, { status: 404 });
    }

    resolvedParentId = parent.id;
    parentDepth = parent.depth; // 부모 깊이 + 1이 이 댓글의 깊이가 된다.
  }

  // 댓글 내용에서 금칙어를 필터링
  const filteredContent = await filterBlockedWords(content);

  // 게시물과 댓글 테이블사용, parent_id로 계층을 구분한다.
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO board_posts
       (user_id, parent_id, thread_id, depth, author, password_hash, title, content)
     VALUES
       (:userId, :parentId, :threadId, :depth, :author, '', '', :content)`,
    {
      userId: user.id,
      parentId: resolvedParentId,
      threadId,
      depth: parentDepth + 1, // 부모보다 +1
      author: user.displayName,
      content: filteredContent
    }
  );

  // 댓글에 첨부된 이미지 저장
  await saveAttachments(result.insertId, user.id, validation.files);

  // 201 Created: 새 댓글이 생성되었음을 나타낸다.
  return NextResponse.json({ id: result.insertId }, { status: 201 });
}
