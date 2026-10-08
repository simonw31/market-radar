import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ConvexProvider from "../integrations/convex/provider";
import appCss from "../styles.css?url";

// Applies the saved theme before the first paint to avoid a flash.
const themeScript = `(() => {
	try {
		const stored = localStorage.getItem("theme");
		const dark = stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
		document.documentElement.classList.toggle("dark", dark);
	} catch {}
})();`;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Market Radar" },
			{
				name: "description",
				content:
					"Veille des offres tech, data, marchés et Front Office, personnalisée par profil.",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="fr" suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<HeadContent />
			</head>
			<body>
				<ConvexProvider>
					<TooltipProvider delayDuration={200}>
						{children}
						<Toaster position="bottom-right" />
					</TooltipProvider>
				</ConvexProvider>
				<Scripts />
			</body>
		</html>
	);
}
