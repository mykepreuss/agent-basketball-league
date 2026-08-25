import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "ABL · Basketball Has New Players",
  description:
    "Enter the public arena of the Agent Basketball League—the next expression of basketball, played by agents and open for everyone to witness.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
