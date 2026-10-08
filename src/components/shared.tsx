import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ProfileDot({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const initials = name
		.split(/[\s·&]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
	return (
		<span
			className={cn(
				"grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-[10px] font-semibold text-background",
				className,
			)}
		>
			{initials || "?"}
		</span>
	);
}

export function PriorityBadge({ priority }: { priority: string }) {
	return (
		<Badge
			variant="outline"
			className={cn(
				"tabular h-5 rounded-full px-1.5 text-[11px] font-medium",
				priority === "P1" && "border-transparent bg-success-soft text-success",
				priority === "P2" && "border-transparent bg-info-soft text-info",
				priority === "P3" && "text-muted-foreground",
			)}
		>
			{priority}
		</Badge>
	);
}

export function ScorePill({
	score,
	className,
}: {
	score: number;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"tabular inline-flex h-7 min-w-10 items-center justify-center rounded-full border px-2 text-sm font-semibold",
				score >= 75 && "border-success/30 text-success",
				className,
			)}
		>
			{score}
		</span>
	);
}

export function SectionHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: React.ReactNode;
	actions?: React.ReactNode;
}) {
	return (
		<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				{description && (
					<p className="mt-1 text-sm text-muted-foreground">{description}</p>
				)}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}

export function useDebounced<T>(value: T, delay = 250) {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(timer);
	}, [value, delay]);
	return debounced;
}

const relative = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

export function timeAgo(timestamp?: number) {
	if (!timestamp) return "jamais";
	const minutes = Math.round((timestamp - Date.now()) / 60_000);
	if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return relative.format(hours, "hour");
	return relative.format(Math.round(hours / 24), "day");
}

export const weekdayNames = [
	"dimanche",
	"lundi",
	"mardi",
	"mercredi",
	"jeudi",
	"vendredi",
	"samedi",
];

export function scheduleLabel(profile: {
	frequency: string;
	weekday: number;
	hour: number;
}) {
	const hour = `${String(profile.hour).padStart(2, "0")}:00`;
	return profile.frequency === "daily"
		? `Chaque jour à ${hour}`
		: `Chaque ${weekdayNames[profile.weekday]} à ${hour}`;
}
