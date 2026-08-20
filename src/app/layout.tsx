import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "BlackSpace AI",
  description:
    "A transparent AI agent: every tool call, token and reasoning step is recorded and replayable.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
