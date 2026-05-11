import mysql from "mysql2/promise";

const globalForMysql = globalThis as unknown as {
  mysqlPool?: mysql.Pool;
  dbInited?: boolean;
};

// MySQL 데이터베이스 연결
export const pool =
  globalForMysql.mysqlPool ??
  mysql.createPool({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "node_board",
    waitForConnections: true, // 연결이 꽉 찼을 때 대기
    connectionLimit: 10,      // 동시에 열 수 있는 최대 연결 수
    namedPlaceholders: true   
  });

if (process.env.NODE_ENV !== "production") {
  globalForMysql.mysqlPool = pool;
}

// 구글 로그인 기능 추가 시 필요한 google_id 컬럼 자동 추가
pool.execute("ALTER TABLE users ADD COLUMN google_id VARCHAR(255) NULL DEFAULT NULL")
  .catch(() => undefined);
pool.execute("ALTER TABLE users ADD UNIQUE INDEX uq_users_google_id (google_id)")
  .catch(() => undefined);


