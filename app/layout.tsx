import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Remote Limelight",
	description: "Stream Limelight camera and send controller input to your PC",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
