# CLAUDE.md

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 작업할 때 참고하는 가이드입니다.

## 명령어

```bash
npm run dev      # 개발 서버 실행 → http://localhost:3000
npm run build    # 프로덕션 빌드 (tsc 타입 검사 포함)
npm run lint     # ESLint (next/core-web-vitals)
npm run start    # 프로덕션 빌드 서빙
```

테스트 프레임워크 없음. 타입 오류는 `npm run build`로 확인.

---

## 기술 스택

| 레이어 | 선택 |
|---|---|
| 프레임워크 | Next.js 14 (App Router) |
| 언어 | TypeScript 5 — `strict: true`, `allowJs: false`, target `es2017` |
| UI | React 18 — `"use client"` 단일 컴포넌트, UI 라이브러리 없음 |
| 스타일 | 순수 CSS (`globals.css`) — CSS 커스텀 프로퍼티, 모듈·Tailwind 없음 |
| 데이터베이스 | MySQL 8, **mysql2/promise**, `namedPlaceholders: true` |
| 인증 | PBKDF2(Node `crypto`) + httpOnly 세션 쿠키 |
| 로컬 DB | XAMPP (MySQL) |

상태 관리 라이브러리 없음. 외부 폰트 CDN 없음(시스템 폰트 스택만 사용).

---

## 프로젝트 구조

```
app/
  layout.tsx              # RootLayout — <html lang="ko">, globals.css 임포트, Metadata
  page.tsx                # 전체 UI (~1090줄, "use client")
  globals.css             # 모든 스타일 — :root에 CSS 변수 정의, BEM 스타일 클래스명
  api/
    auth/
      login/route.ts      # POST — node_board_session 쿠키 발급
      logout/route.ts     # POST — 쿠키 삭제
      register/route.ts   # POST — 회원 가입
      me/route.ts         # GET  — 현재 로그인 유저 반환
    posts/
      route.ts            # GET 목록, POST 게시물 생성 (multipart 또는 JSON)
      [id]/
        route.ts          # GET 상세+댓글 트리, PATCH 수정, DELETE 소프트 삭제
        comments/
          route.ts        # POST — 모든 depth에 댓글/답글 추가
    attachments/
      [id]/route.ts       # GET — LONGBLOB 이미지 서빙 (Cache-Control 포함)
lib/
  auth.ts                 # hashPassword, verifyPassword, getCurrentUser, 세션 유틸
  attachments.ts          # validateImageFiles, saveAttachments
  db.ts                   # mysql2 풀 싱글턴 (개발 환경에서 globalThis에 유지)
  types.ts                # 공유 타입: Attachment, PostSummary, ReplyNode, PostDetail
migrations/
  schema.sql              # DROP → CREATE → 어드민·웰컴 게시물 시드
```

---

## 데이터베이스 스키마

`board_posts` 단일 테이블에 게시물과 댓글을 모두 저장:

| 컬럼 | 의미 |
|---|---|
| `parent_id IS NULL` | 최상위 게시물 |
| `thread_id` | 스레드 루트 게시물의 ID (루트 자신의 `id`와 동일) |
| `depth` | 0 = 게시물, 1 이상 = 댓글 중첩 레벨 |
| `is_deleted = 1` | 소프트 삭제 (물리 DELETE 금지) |

이미지는 `attachments` 테이블의 `LONGBLOB`으로 저장. `GET /api/attachments/[id]`로 서빙.

**XAMPP 주의:** 기본 `max_allowed_packet`은 1 MB. 최대 8 MB 이미지를 허용하려면 런타임에 설정:
```sql
SET GLOBAL max_allowed_packet = 67108864;
```
MySQL 재시작 시 초기화되므로 `my.ini`에 `max_allowed_packet=64M`을 추가해 영구 적용.

**어드민 비밀번호:** 스키마 시드에는 bcrypt 해시(CI3 레거시)가 포함되어 있음. 마이그레이션 후 `lib/auth.ts`의 `hashPassword()`로 PBKDF2 해시를 생성해 업데이트 필요:
```sql
UPDATE users SET password_hash = '<pbkdf2$...>' WHERE username = 'admin';
```

---

## 코딩 컨벤션

### TypeScript
- `strict: true` — 암묵적 `any` 금지, 타입 누락 금지.
- 공유 데이터 타입은 `lib/types.ts`에. 컴포넌트 전용 타입(DraftPost, ReplyDraft 등)은 `page.tsx`에 함께 위치.
- mysql2 쿼리 결과 타입은 `RowDataPacket & { ... }` 형태로 선언.

### SQL
- 모든 쿼리에 **named placeholder**(`:paramName`) 사용 — `pool.execute()` 호출.
- 예외: `IN (${placeholders})` 구문은 배열 확장이 필요하므로 위치 기반 `?`와 `pool.query()` 사용.
- 게시물·댓글은 소프트 삭제만 허용 — `DELETE FROM board_posts` 금지.

### API Route Handler
- 핸들러 상단에서 `content-type` 헤더를 확인해 `multipart/form-data`와 JSON 모두 처리.
- 인증이 필요한 핸들러는 `getCurrentUser()`를 최상단에서 호출하고 null이면 즉시 401 반환.
- 오류 응답은 `NextResponse.json({ message: "..." })` + 적절한 상태 코드로 통일.

### 프론트엔드 (`page.tsx`)
- 모든 UI 문자열은 파일 상단의 `text` 상수 객체에 집중 관리 — 한국어 문자열을 인라인으로 쓰지 않음.
- draft 상태 초기화 시 `makeEmptyPost()` / `makeEmptyReply()` 팩토리 함수 사용 — 공유 참조 버그 방지.
- `requestJson<T>()`: `FormData` 바디를 자동 감지해 `Content-Type`을 생략(브라우저가 multipart boundary 설정). 모든 fetch 호출에 이 함수 사용.
- `buildPostFormData()` / `buildReplyFormData()`: FormData 생성을 중앙화 — 인라인으로 FormData를 직접 생성하지 않음.
- 답글 폼·수정 폼은 동시에 하나만 열림 — `openReplyId`와 `editingReplyId` 상태로 제어. 하나를 설정하면 다른 하나를 null로 초기화.
- 핸들러 함수 네이밍: `handle*` (예: `handleLogin`, `handleCreatePost`). 댓글·수정 제출 함수: `submit*`.

### 스타일
- 색상은 `globals.css` `:root`에 정의된 CSS 변수(`var(--navy)`, `var(--border)` 등) 사용 — 하드코딩 금지.
- 클래스명은 BEM 영감의 플랫 네이밍 방식: `.comment-body`, `.comment-meta`, `.comment-actions`.
- CSS 모듈 없음 — 모든 스타일은 `globals.css` 단일 파일.

---

## 성능 기준 — Lighthouse 90점 이상 (전 카테고리)

이 앱은 클라이언트 사이드 렌더링 SPA이므로 LCP·번들 크기·접근성이 주요 위험 요소.

**기준 유지 원칙:**

- **번들 크기:** 근거 없이 npm 패키지를 추가하지 않음. 현재 런타임 의존성은 React·Next.js만.
- **이미지 캐시:** 첨부 이미지는 `Cache-Control: private, max-age=86400`으로 서빙 — 이 헤더를 제거하지 않음. `<img>`에는 반드시 `alt` 속성 포함.
- **폰트:** `Arial`, `Apple SD Gothic Neo`, `Malgun Gothic` 시스템 폰트 스택 — 웹 폰트 CDN 요청 없음.
- **접근성:** `<html lang="ko">` 유지. `<nav>`의 `aria-label` 유지. 클릭 핸들러는 반드시 `<button>` 또는 `<a>`에만 부착 (`<div>` 클릭 금지).
- **제목 계층:** `<h1>` 게시판 제목 → `<h2>` 게시물 제목 → `<h3>` 댓글 섹션 — 레벨 건너뜀 금지.
- **CLS:** 이미지가 비동기 로드되는 영역은 컨테이너 크기를 명시해 레이아웃 이동 방지.
- **SEO:** `layout.tsx`의 `Metadata`에 `title`과 `description` 유지.

**측정 방법:** `npm run build && npm run start` 후 Chrome DevTools Lighthouse를 시크릿 창(확장 프로그램 비활성화)에서 실행.
