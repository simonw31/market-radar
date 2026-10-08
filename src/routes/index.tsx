import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
	Activity,
	FileText,
	ListChecks,
	Moon,
	Radar,
	Sun,
	UsersRound,
	Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import { ApplicationsView } from "../components/ApplicationsView";
import { OperationsPanel } from "../components/OperationsPanel";
import { RadarView } from "../components/RadarView";
import { RoutinePanel } from "../components/RoutinePanel";
import { ProfileDot } from "../components/shared";
import { TaskTray } from "../components/TaskTray";
import { TrackingView } from "../components/TrackingView";
import { WorkflowBoard } from "../components/WorkflowBoard";

const views = [
	{ id: "radar", label: "Radar", icon: Radar },
	{ id: "candidatures", label: "Candidatures", icon: FileText },
	{ id: "suivi", label: "Suivi", icon: ListChecks },
	{ id: "profils", label: "Profils", icon: UsersRound },
	{ id: "collecte", label: "Collecte", icon: Activity },
	{ id: "workflow", label: "Workflow", icon: Workflow },
] as const;
type View = (typeof views)[number]["id"];

type Search = { view?: View; profile?: string; application?: string };

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): Search => ({
		view: views.some((view) => view.id === search.view)
			? (search.view as View)
			: undefined,
		profile: typeof search.profile === "string" ? search.profile : undefined,
		application:
			typeof search.application === "string" ? search.application : undefined,
	}),
	component: Home,
});

function Home() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/" });
	const settings = useQuery(api.settings.get);
	const operations = useQuery(api.operations.overview);
	const profiles = settings?.profiles ?? [];
	const view = search.view ?? "radar";
	const activeProfile =
		profiles.find((profile) => profile.id === search.profile) ?? profiles[0];
	const workerOnline = Boolean(
		operations?.system?.workerSeenAt &&
			Date.now() - operations.system.workerSeenAt < 90_000,
	);
	const scanActive =
		operations?.scan?.status === "running" ||
		operations?.scan?.status === "queued";

	function go(next: Partial<Search>) {
		void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
	}

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
				<div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:flex-nowrap sm:py-0 sm:px-6">
					<button
						type="button"
						onClick={() => go({ view: "radar" })}
						className="flex items-center gap-2.5 rounded-md pr-2 font-semibold tracking-tight"
					>
						<span className="grid size-7 place-items-center rounded-md bg-foreground text-background">
							<Radar className="size-4" strokeWidth={2.25} />
						</span>
						<span className="hidden sm:inline">Market Radar</span>
					</button>
					<nav
						aria-label="Navigation principale"
						className="order-last -mx-1 flex w-full items-center gap-0.5 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto"
					>
						{views.map(({ id, label, icon: Icon }) => (
							<Button
								key={id}
								size="sm"
								variant="ghost"
								aria-current={view === id ? "page" : undefined}
								onClick={() => go({ view: id })}
								className={cn(
									"gap-1.5 text-muted-foreground",
									view === id && "bg-accent text-foreground",
								)}
							>
								<Icon className="size-4" />
								<span>{label}</span>
								{id === "collecte" && scanActive && (
									<span className="size-1.5 animate-pulse rounded-full bg-success" />
								)}
							</Button>
						))}
					</nav>
					<div className="ml-auto flex items-center gap-2">
						{profiles.length > 0 && (
							<Select
								value={activeProfile?.id}
								onValueChange={(profile) => go({ profile })}
							>
								<SelectTrigger
									size="sm"
									className="h-8 max-w-[260px] gap-2"
									aria-label="Profil actif"
								>
									<ProfileDot name={activeProfile?.name ?? ""} />
									<SelectValue />
								</SelectTrigger>
								<SelectContent align="end">
									{profiles.map((profile) => (
										<SelectItem key={profile.id} value={profile.id}>
											{profile.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground sm:flex">
									<span
										className={cn(
											"size-1.5 rounded-full",
											workerOnline ? "bg-success" : "bg-destructive",
										)}
									/>
									{workerOnline ? "En ligne" : "Hors ligne"}
								</span>
							</TooltipTrigger>
							<TooltipContent>
								Worker {workerOnline ? "actif" : "injoignable"} · Ollama{" "}
								{operations?.system?.ollamaStatus === "connected"
									? "connecté"
									: "indisponible"}
							</TooltipContent>
						</Tooltip>
						<ThemeToggle />
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
				{view === "radar" && (
					<RadarView
						profileId={activeProfile?.id}
						onOpenApplication={(application) =>
							go({ view: "candidatures", application })
						}
					/>
				)}
				{view === "candidatures" && (
					<ApplicationsView
						selectedId={search.application}
						onSelect={(application) => go({ application })}
					/>
				)}
				{view === "profils" && (
					<RoutinePanel
						selectedId={activeProfile?.id}
						onSelect={(profile) => go({ profile })}
					/>
				)}
				{view === "suivi" && <TrackingView />}
				{view === "collecte" && <OperationsPanel />}
				{view === "workflow" && <WorkflowBoard profileId={activeProfile?.id} />}
			</main>

			<TaskTray
				raised={view === "profils"}
				onOpen={(link) =>
					go({
						view: link.view as View,
						...(link.application ? { application: link.application } : {}),
					})
				}
			/>

			<footer className="border-t">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
					<span>Market Radar · données hébergées sur ton serveur</span>
					<span>Aucune candidature n’est envoyée sans ta validation</span>
				</div>
			</footer>
		</div>
	);
}

function ThemeToggle() {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		setDark(document.documentElement.classList.contains("dark"));
	}, []);
	function toggle() {
		const next = !dark;
		setDark(next);
		document.documentElement.classList.toggle("dark", next);
		try {
			localStorage.setItem("theme", next ? "dark" : "light");
		} catch {}
	}
	return (
		<Button
			variant="ghost"
			size="icon"
			className="size-8"
			onClick={toggle}
			aria-label={dark ? "Passer en thème clair" : "Passer en thème sombre"}
		>
			{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
		</Button>
	);
}
