import { useMutation, useQuery } from "convex/react";
import {
	Bot,
	CheckCircle2,
	CircleDashed,
	LoaderCircle,
	Mail,
	Play,
	Server,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import { SourceStatus } from "./RoutinePanel";
import { SectionHeader, timeAgo } from "./shared";

const time = new Intl.DateTimeFormat("fr-FR", {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});
const dateTime = new Intl.DateTimeFormat("fr-FR", {
	dateStyle: "short",
	timeStyle: "short",
});

function triggerLabel(scan: {
	trigger?: string;
	sendReport?: boolean;
	profileName?: string;
}) {
	if (scan.trigger === "scheduled")
		return `Routine planifiée · ${scan.profileName}`;
	if (scan.sendReport) return `Routine forcée · ${scan.profileName}`;
	return "Collecte manuelle";
}

export function OperationsPanel() {
	const overview = useQuery(api.operations.overview);
	const sources = useQuery(api.jobs.overview);
	const requestScan = useMutation(api.operations.requestScan);
	const scan = overview?.scan;
	const active = scan?.status === "queued" || scan?.status === "running";
	const percent = scan
		? Math.round((scan.completedSources / Math.max(1, scan.totalSources)) * 100)
		: 0;
	const workerOnline = Boolean(
		overview?.system?.workerSeenAt &&
			Date.now() - overview.system.workerSeenAt < 90_000,
	);
	const ollamaOnline = overview?.system?.ollamaStatus === "connected";
	const consoleEnd = useRef<HTMLDivElement>(null);
	const eventCount = overview?.events.length ?? 0;
	useEffect(() => {
		// Scroll the log itself, never the page.
		const viewport = consoleEnd.current?.closest<HTMLElement>(
			"[data-slot=scroll-area-viewport]",
		);
		if (eventCount && viewport) viewport.scrollTop = viewport.scrollHeight;
	}, [eventCount]);

	const latestBySource = new Map(
		(overview?.events ?? [])
			.filter((event) => event.sourceName)
			.map((event) => [event.sourceName, event]),
	);
	const phases = [
		{ id: "queued", label: "File d’attente" },
		{ id: "collecting", label: "Collecte et scoring" },
		...(scan?.sendReport ? [{ id: "reporting", label: "Rapport email" }] : []),
		{ id: "completed", label: "Terminé" },
	];
	const phaseIndex = Math.max(
		0,
		phases.findIndex((phase) =>
			phase.id === "collecting"
				? scan?.currentPhase === "collecting" ||
					scan?.currentPhase === "scoring"
				: phase.id === scan?.currentPhase,
		),
	);

	async function launch() {
		try {
			await requestScan({ totalSources: sources?.stats.connected ?? 40 });
			toast.success("Collecte ajoutée à la file", {
				description: "Aucun email n’est envoyé par une collecte manuelle.",
			});
		} catch (error) {
			toast.error("Impossible de lancer la collecte", {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	}

	return (
		<div>
			<SectionHeader
				title="Collecte"
				description="Suis le worker visiter les sites carrières, normaliser et scorer les offres en direct."
				actions={
					<Button onClick={launch} disabled={active || !workerOnline}>
						{active ? <LoaderCircle className="animate-spin" /> : <Play />}
						{active ? "Collecte en cours" : "Lancer une collecte"}
					</Button>
				}
			/>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Health
					icon={<Server />}
					label="Worker"
					value={workerOnline ? "En ligne" : "Hors ligne"}
					hint={`Vu ${timeAgo(overview?.system?.workerSeenAt)}`}
					ok={workerOnline}
				/>
				<Health
					icon={<Bot />}
					label="Ollama"
					value={
						ollamaOnline
							? (overview?.system?.ollamaModel ?? "Connecté")
							: "Indisponible"
					}
					hint="IA locale du workflow"
					ok={ollamaOnline}
				/>
				<Health
					icon={<CheckCircle2 />}
					label="Sources actives"
					value={`${sources?.stats.connected ?? "…"} / ${sources?.sources.length ?? "…"}`}
					hint={`${sources?.stats.total.toLocaleString("fr-FR") ?? "…"} offres suivies`}
					ok
				/>
				<Health
					icon={<TriangleAlert />}
					label="Sources en erreur"
					value={String(sources?.stats.errors ?? "…")}
					hint="Erreurs de la dernière collecte"
					ok={(sources?.stats.errors ?? 0) === 0}
				/>
			</div>

			<Card className="mt-6">
				<CardHeader>
					<CardDescription>
						{scan ? triggerLabel(scan) : "Aucune collecte pour l’instant"}
					</CardDescription>
					<CardTitle className="text-lg">
						{!scan
							? "En attente d’un lancement"
							: scan.currentPhase === "reporting"
								? `Envoi du rapport « ${scan.profileName} »`
								: active
									? (scan.currentSource ?? "Démarrage…")
									: scan.status === "error"
										? "Terminé avec une erreur"
										: "Collecte terminée"}
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-5">
					<div className="flex items-center gap-4">
						<Progress value={percent} className="h-2" />
						<span className="tabular w-12 text-right text-sm font-medium">
							{percent} %
						</span>
					</div>
					<ol className="grid gap-2 sm:grid-flow-col">
						{phases.map((phase, index) => {
							const done =
								scan?.status === "completed" || (active && index < phaseIndex);
							const current = active && index === phaseIndex;
							return (
								<li
									key={phase.id}
									className={cn(
										"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
										current && "border-foreground/30 bg-muted",
										!done && !current && "text-muted-foreground",
									)}
								>
									{done ? (
										<CheckCircle2 className="size-4 text-success" />
									) : current ? (
										<LoaderCircle className="size-4 animate-spin" />
									) : (
										<CircleDashed className="size-4" />
									)}
									{phase.id === "reporting" && <Mail className="size-3.5" />}
									{phase.label}
								</li>
							);
						})}
					</ol>
					{scan?.status === "error" && scan.error && (
						<p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							{scan.error}
						</p>
					)}
				</CardContent>
			</Card>

			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
				<Card className="gap-0 overflow-hidden py-0">
					<div className="flex items-center justify-between border-b px-4 py-3">
						<span className="flex items-center gap-2 text-sm font-medium">
							<span
								className={cn(
									"size-1.5 rounded-full",
									active ? "animate-pulse bg-success" : "bg-muted-foreground",
								)}
							/>
							Journal
						</span>
						<span className="text-xs text-muted-foreground">temps réel</span>
					</div>
					<ScrollArea className="h-[420px]">
						<div className="space-y-1 p-4 font-mono text-xs">
							{(overview?.events ?? []).map((event) => (
								<p key={event._id} className="flex gap-3 leading-relaxed">
									<time className="shrink-0 text-muted-foreground">
										{time.format(event.at)}
									</time>
									<span
										className={cn(
											event.status === "error" && "text-destructive",
											event.status === "completed" && "text-success",
										)}
									>
										{event.message}
									</span>
								</p>
							))}
							{eventCount === 0 && (
								<p className="text-muted-foreground">
									Lance une collecte pour voir le worker parcourir les sources.
								</p>
							)}
							<div ref={consoleEnd} />
						</div>
					</ScrollArea>
				</Card>

				<div className="flex flex-col gap-6">
					<Card className="gap-0 overflow-hidden py-0">
						<div className="flex items-center justify-between border-b px-4 py-3 text-sm font-medium">
							Activité par source
							<span className="tabular text-xs font-normal text-muted-foreground">
								{latestBySource.size} / {scan?.totalSources ?? "…"}
							</span>
						</div>
						<ScrollArea className="h-[260px]">
							<ul className="divide-y">
								{[...latestBySource.values()].reverse().map((event) => (
									<li
										key={event._id}
										className="flex items-center gap-3 px-4 py-2.5"
									>
										<SourceStatus
											status={
												event.status === "visiting"
													? "running"
													: event.status === "completed"
														? "connected"
														: "error"
											}
										/>
										<span className="flex-1 truncate text-sm">
											{event.sourceName}
										</span>
										<span className="text-xs text-muted-foreground">
											{event.status === "visiting"
												? "lecture…"
												: event.status === "completed"
													? "scorée"
													: "erreur"}
										</span>
									</li>
								))}
								{latestBySource.size === 0 && (
									<li className="px-4 py-6 text-center text-sm text-muted-foreground">
										Les sources apparaissent ici pendant la collecte.
									</li>
								)}
							</ul>
						</ScrollArea>
					</Card>
					<Card className="gap-3">
						<CardHeader>
							<CardTitle className="text-sm">Historique</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="space-y-2.5">
								{overview?.history.map((item) => (
									<li
										key={item._id}
										className="flex items-center gap-3 text-sm"
									>
										<Badge
											variant="outline"
											className={cn(
												"h-5 px-1.5 text-[10px]",
												item.status === "completed" && "text-success",
												item.status === "error" && "text-destructive",
											)}
										>
											{item.status === "completed"
												? "OK"
												: item.status === "error"
													? "Erreur"
													: "En cours"}
										</Badge>
										<span className="min-w-0 flex-1 truncate">
											{triggerLabel(item)}
										</span>
										<span className="tabular shrink-0 text-xs text-muted-foreground">
											{dateTime.format(item.requestedAt)}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}

function Health({
	icon,
	label,
	value,
	hint,
	ok,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	hint: string;
	ok: boolean;
}) {
	return (
		<Card className="flex-row items-center gap-3 px-4 py-4">
			<span
				className={cn(
					"grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
					ok
						? "bg-success-soft text-success"
						: "bg-destructive/10 text-destructive",
				)}
			>
				{icon}
			</span>
			<div className="min-w-0">
				<p className="text-xs text-muted-foreground">{label}</p>
				<p className="truncate font-medium">{value}</p>
				<p className="truncate text-xs text-muted-foreground">{hint}</p>
			</div>
		</Card>
	);
}
