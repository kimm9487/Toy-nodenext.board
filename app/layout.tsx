import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "답변형 게시판",
  description: "Next.js와 MySQL로 만든 댓글/대댓글 게시판"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <Script src="https://accounts.google.com/gsi/client" strategy="lazyOnload" />
      </body>
    </html>
  );
}
