import { NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getCurrentUser } from "@/lib/auth";
import { pool } from "@/lib/db";
import { saveAttachments, validateImageFiles } from "@/lib/attachments";
import { filterBlockedWords } from "@/lib/filter";
import type { Attachment, PostSummary } from "@/lib/types";

// DB board_posts 테이블 한 행의 구조 (목록 조회용)
type PostRow = RowDataPacket & {
  id: number;
  user_id: number;
  title: string;
  content: string;
  author: string;
  view_count: number;
  created_at: Date;
  updated_at: Date | null;
  reply_count: number;
  is_notice: number;  // 0 또는 1로 표시된 공지글 여부
};

// DB attachments 테이블 한 행의 구조 (데이터 자체 제외)
type AttachmentRow = RowDataPacket & {
  id: number;
  post_id: number;
  filename: string;
  mime_type: string;
  byte_size: number;
};

// DB에서 가져온 게시물 행을 프론트엔드가 사용하는 PostSummary 형태로 변환
// DB의 스네이크케이스 컬럼명을 카멜케이스로 변환 날짜 ISO 문자열로 변환
function normalizePost(row: PostRow, attachments: Attachment[] = []): PostSummary {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    author: row.author,
    viewCount: row.view_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    replyCount: row.reply_count,
    attachments,
    isNotice: row.is_notice === 1 // 0 false, 1 true
  };
}

// 여러 게시물의 첨부 이미지를 한 번의 쿼리로 모두 가져와서 게시물 ID별로 분류
async function loadAttachmentsByPostIds(postIds: number[]) {
  if (postIds.length === 0) return new Map<number, Attachment[]>();
  const placeholders = postIds.map(() => "?").join(",");
  const [rows] = await pool.query<AttachmentRow[]>(
    `SELECT id, post_id, filename, mime_type, byte_size
     FROM attachments
     WHERE post_id IN (${placeholders})
     ORDER BY id ASC`,
    postIds
  );
  // 결과를 Map<게시물ID, 첨부파일 배열> 형태로 조립
  const map = new Map<number, Attachment[]>();
  for (const row of rows) {
    const list = map.get(row.post_id) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      byteSize: row.byte_size
    });
    map.set(row.post_id, list);
  }
  return map;
}

// 게시물 목록을 반환 공지글이 최우선
export async function GET() {
  const [rows] = await pool.query<PostRow[]>(
    `SELECT
       p.id,
       p.user_id,
       p.title,
       p.content,
       p.author,
       p.view_count,
       p.is_notice,
       p.created_at,
       p.updated_at,
       (
         SELECT COUNT(*)
         FROM board_posts r
         WHERE r.thread_id = p.id
           AND r.id <> p.id
           AND r.is_deleted = 0
       ) AS reply_count
     FROM board_posts p
     WHERE p.parent_id IS NULL
       AND p.is_deleted = 0
     ORDER BY p.is_notice DESC, p.created_at DESC, p.id DESC`
  );

  // 모든 게시물의 첨부파일을 한꺼번에 불러온 뒤 각 게시물에 연결
  const attachmentsMap = await loadAttachmentsByPostIds(rows.map((r) => r.id));
  return NextResponse.json(rows.map((r) => normalizePost(r, attachmentsMap.get(r.id) ?? [])));
}

// 이미지가 있으면 multipart/form-data 없으면 JSON으로 요청
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "로그인 후 이용해주세요." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let title = "";
  let content = "";
  let images: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    // 이미지 업로드가 포함된 요청 FormData로
    const form = await request.formData();
    title = String(form.get("title") ?? "").trim();
    content = String(form.get("content") ?? "").trim();
    images = form.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
  } else {
    // 이미지 없는 요청 JSON으로
    const body = await request.json().catch(() => null);
    title = String(body?.title ?? "").trim();
    content = String(body?.content ?? "").trim();
  }

  // 제목 내용 필수 입력 검사
  if (!title || !content) {
    return NextResponse.json({ message: "제목과 내용을 모두 입력해주세요." }, { status: 400 });
  }

  // 제목 최대 길이 검사
  if (title.length > 200) {
    return NextResponse.json({ message: "제목이 너무 깁니다." }, { status: 400 });
  }

  // 이미지 파일 형식 크기 검사
  const validation = validateImageFiles(images);
  if (!validation.ok) {
    return NextResponse.json({ message: validation.message }, { status: 400 });
  }

  // 제목 내용에서 금칙어를 필터링
  const [filteredTitle, filteredContent] = await Promise.all([
    filterBlockedWords(title),
    filterBlockedWords(content)
  ]);

  // board_posts 테이블에 새 게시물을 삽입
  // parent_id=NULL, depth=0으로 최상위 게시물임을 표시
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO board_posts
       (user_id, parent_id, thread_id, depth, author, password_hash, title, content)
     VALUES
       (:userId, NULL, NULL, 0, :author, '', :title, :content)`,
    { userId: user.id, author: user.displayName, title: filteredTitle, content: filteredContent }
  );

  // thread_id는 자기 자신의 id와 동일하게 설정한다 (INSERT 후에 id가 확정되므로 UPDATE로 처리)
  await pool.execute(
    "UPDATE board_posts SET thread_id = :id WHERE id = :id",
    { id: result.insertId }
  );

  // 이미지 파일을 DB에 저장
  await saveAttachments(result.insertId, user.id, validation.files);

  // 방금 생성한 게시물을 다시 조회해 정규화 반환
  const [rows] = await pool.execute<PostRow[]>(
    `SELECT
       p.id,
       p.user_id,
       p.title,
       p.content,
       p.author,
       p.view_count,
       p.created_at,
       p.updated_at,
       0 AS reply_count
     FROM board_posts p
     WHERE p.id = :id`,
    { id: result.insertId }
  );

  const attachmentsMap = await loadAttachmentsByPostIds([result.insertId]);
  return NextResponse.json(normalizePost(rows[0], attachmentsMap.get(result.insertId) ?? []), {
    status: 201 
  });
}
