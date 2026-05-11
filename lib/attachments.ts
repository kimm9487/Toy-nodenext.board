import { ResultSetHeader } from "mysql2";
import { pool } from "@/lib/db";

// 허용되는 이미지 파일 형식 (JPEG, PNG, GIF만 허용)
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/gif"] as const;
// 파일 한 개의 최대 크기: 8MB
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// 유효성 검사 실패 결과 타입: ok가 false이고 오류 메시지 포함
export type ValidationError = { ok: false; message: string };
// 유효성 검사 성공 결과 타입: ok가 true이고 검사 통과한 파일 목록 포함
export type ValidationOk = { ok: true; files: File[] };

// 업로드하려는 이미지 파일들이 형식과 크기 규정을 지키는지 검사
// 하나라도 통과 못 하면 실패(ValidationError)를 반환, 전부 통과하면 성공(ValidationOk)을 반환
export function validateImageFiles(files: File[]): ValidationError | ValidationOk {
  for (const file of files) {
    // 허용되지 않는 파일 형식이면 즉시 오류 반환
    if (!ALLOWED_IMAGE_MIME.includes(file.type as (typeof ALLOWED_IMAGE_MIME)[number])) {
      return { ok: false, message: `허용되지 않는 파일 형식입니다: ${file.name || file.type}` };
    }
    // 8MB를 초과하면 즉시 오류 반환
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, message: `이미지가 너무 큽니다(최대 ${MAX_IMAGE_BYTES / 1024 / 1024}MB).` };
    }
  }
  return { ok: true, files };
}

// 검사를 통과한 이미지 파일들을 DB의 attachments 테이블 저장
// 파일 데이터 자체를 LONGBLOB 으로 넣기 (별도 파일 서버 없이 DB 직접 저장 방식)
export async function saveAttachments(postId: number, userId: number, files: File[]) {
  for (const file of files) {
    // 파일을 바이트 배열(Buffer)로 변환해 DB에 삽입
    const buffer = Buffer.from(await file.arrayBuffer());
    await pool.execute<ResultSetHeader>(
      `INSERT INTO attachments (post_id, user_id, filename, mime_type, byte_size, data)
       VALUES (:postId, :userId, :filename, :mimeType, :byteSize, :data)`,
      {
        postId,
        userId,
        filename: (file.name || "image").slice(0, 255), 
        mimeType: file.type,
        byteSize: file.size,
        data: buffer
      }
    );
  }
}
