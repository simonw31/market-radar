import { useQuery } from "convex/react";
import {
	CheckCircle2,
	ChevronDown,
	CircleAlert,
	FileText,
	LoaderCircle,
	Mail,
	Radar,
	ScanText,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";

// Typical durations, to show an estimated progress when the task has no
// measurable steps (local AI on a small server).
const EXPECTED_MS: Record<string, number> = {
	candidature: 90_000,
	pdf: 12_000,
	envoi: 10_000,
	cv: 200_000,
};

const ICONS = {
	collecte: Radar,
	candidature: FileText,
	pdf: FileText,
	envoi: Mail,
	cv: ScanText,
};

/** Bottom-right tray: every task launched from the app and its progress. */
export function TaskTray({
	onOpen,
	raised = false,
}: {
	onOpen: (link: { view: string; application?: string }) => void;
	raised?: boolean;
}) {
	const tasks = useQuery(api.operations.activity) ?? [];
	const [collapsed, setCollapsed] = useState(false);
	const [now, setNow] = useState(Date.now());
	const known = useRef(new Set<string>());
	const active = tasks.filter(
		(task) => task.state === "running" || task.state === "queued",
	);

	// A new task re-opens the tray.
	useEffect(() => {
		const fresh = tasks.some((task) => !known.current.has(task.id));
		for (const task of tasks) known.current.add(task.id);
		if (fresh) setCollapsed(false);
	}, [tasks]);
	useEffect(() => {
		if (!active.length) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active.length]);

	if (!tasks.length) return null;

	const position = cn("fixed right-4 z-50", raised ? "bottom-20" : "bottom-4");
	if (collapsed) {
		return (
			<button
				type="button"
				onClick={() => setCollapsed(false)}
				className={cn(
					position,
					"flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm shadow-lg",
				)}
			>
				{active.length ? (
					<LoaderCircle className="size-4 animate-spin text-info" />
				) : (
					<CheckCircle2 className="size-4 text-success" />
				)}
				{active.length
					? `${active.length} tâche${active.length > 1 ? "s" : ""} en cours`
					: "Tâches terminées"}
			</button>
		);
	}

	return (
		<div
			className={cn(
				position,
				"w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-card shadow-xl",
			)}
		>
			<div className="flex items-center justify-between border-b px-4 py-2.5">
				<span className="flex items-center gap-2 text-sm font-medium">
					{active.length ? (
						<LoaderCircle className="size-4 animate-spin text-info" />
					) : (
						<CheckCircle2 className="size-4 text-success" />
					)}
					{active.length
						? `${active.length} tâche${active.length > 1 ? "s" : ""} en cours`
						: "Tâches terminées"}
				</span>
				<button
					type="button"
					onClick={() => setCollapsed(true)}
					className="rounded-md p-1 text-muted-foreground hover:bg-muted"
					aria-label="Réduire"
				>
					<ChevronDown className="size-4" />
				</button>
			</div>
			<ul className="max-h-[50vh] divide-y overflow-y-auto">
				{tasks.map((task) => {
					const Icon = ICONS[task.kind];
					const elapsed = task.startedAt ? now - task.startedAt : 0;
					const estimated =
						task.progress ??
						(task.state === "running"
							? Math.min(0.95, elapsed / (EXPECTED_MS[task.kind] ?? 60_000))
							: task.state === "done"
								? 1
								: 0);
					return (
						<li key={task.id}>
							<button
								type="button"
								onClick={() => task.link && onOpen(task.link)}
								className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50"
							>
								<span
									className={cn(
										"mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted",
										task.state === "done" && "bg-success-soft text-success",
										task.state === "error" &&
											"bg-destructive/10 text-destructive",
									)}
								>
									{task.state === "error" ? (
										<CircleAlert className="size-3.5" />
									) : task.state === "done" ? (
										<CheckCircle2 className="size-3.5" />
									) : (
										<Icon className="size-3.5" />
									)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{task.title}
									</span>
									<span className="block truncate text-xs text-muted-foreground">
										{task.detail}
										{task.state === "running" && task.startedAt
											? ` · ${Math.max(1, Math.round(elapsed / 1000))} s`
											: ""}
									</span>
									{(task.state === "running" || task.state === "queued") && (
										<span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
											<span
												className={cn(
													"block h-full rounded-full bg-info transition-[width] duration-1000",
													task.state === "queued" && "w-1/12 animate-pulse",
												)}
												style={
													task.state === "running"
														? { width: `${Math.round(estimated * 100)}%` }
														: undefined
												}
											/>
										</span>
									)}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
