# 답변형 게시판

Next.js, TypeScript, Node.js API Route, MySQL로 만든 게시판입니다. 게시물마다 댓글과 대댓글을 작성할 수 있습니다.

## 실행 준비

1. XAMPP에서 MySQL을 실행합니다.
2. `migrations/schema.sql`을 phpMyAdmin SQL 탭이나 MySQL CLI에서 실행합니다.
3. `.env.local`의 MySQL 접속 정보를 환경에 맞게 조정합니다. 현재 확인된 XAMPP 접속값은 `root` / 빈 비밀번호입니다. `gyuho9480!!` 비밀번호를 쓰려면 먼저 MySQL의 `root` 비밀번호를 해당 값으로 변경한 뒤 `.env.local`의 `MYSQL_PASSWORD`에 넣어주세요.
4. 의존성을 설치하고 개발 서버를 실행합니다.

```bash
npm install
npm run dev
```

PowerShell 실행 정책 때문에 `npm`이 막히면 `npm.cmd install`, `npm.cmd run dev`를 사용하세요.

## DB 스키마

`node_board` 데이터베이스를 만들고 `posts`, `comments` 테이블을 추가합니다. 댓글은 `parent_id`로 자기 참조를 걸어 대댓글 구조를 표현합니다.
