import { useMutation, useQuery } from "convex/react";
import {
	ArrowUpRight,
	Download,
	Inbox,
	Mail,
	MousePointerClick,
	PencilLine,
	Plus,
	Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader, timeAgo } from "./shared";

const OUTCOMES: Array<{ id: string; label: string; tone: string }> = [
	{ id: "envoyee", label: "Envoyée", tone: "" },
	{
		id: "accuse",
		label: "Accusé de réception",
		tone: "bg-info-soft text-info border-transparent",
	},
	{
		id: "test",
		label: "Test",
		tone: "bg-warning-soft text-warning border-transparent",
	},
	{
		id: "entretien",
		label: "Entretien",
		tone: "bg-info-soft text-info border-transparent font-semibold",
	},
	{
		id: "offre",
		label: "Offre",
		tone: "bg-success-soft text-success border-transparent font-semibold",
	},
	{
		id: "refus",
		label: "Refus",
		tone: "border-destructive/30 text-destructive",
	},
	{ id: "abandon", label: "Abandonnée", tone: "text-muted-foreground" },
];
const label = (outcome: string | null) =>
	OUTCOMES.find((item) => item.id === outcome)?.label ?? "À envoyer";
const tone = (outcome: string | null) =>
	OUTCOMES.find((item) => item.id === outcome)?.tone ??
	"border-dashed text-muted-foreground";

const day = new Intl.DateTimeFormat("fr-FR", {
	day: "2-digit",
	month: "short",
	year: "numeric",
});
const dayTime = new Intl.DateTimeFormat("fr-FR", {
	dateStyle: "medium",
	timeStyle: "short",
});
const SOURCE: Record<string, string> = {
	email: "Email reçu",
	extension: "Extension",
	manuel: "Manuel",
};

type Row = NonNullable<
	ReturnType<typeof useQuery<typeof api.tracking.list>>
>["rows"][number];

export function TrackingView() {
	const data = useQuery(api.tracking.list);
	const mails = useQuery(api.tracking.recentMails);
	const setOutcome = useMutation(api.tracking.setOutcome);
	const reassign = useMutation(api.tracking.reassignMail);
	const markSent = useMutation(api.tracking.markSent);
	const [filter, setFilter] = useState("all");
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState<Id<"applications"> | null>(null);
	const [adding, setAdding] = useState(false);
	const now = Date.now();

	const rows = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return (data?.rows ?? []).filter((item) => {
			if (
				needle &&
				!`${item.company} ${item.jobTitle}`.toLowerCase().includes(needle)
			)
				return false;
			if (filter === "waiting")
				return item.outcome === "envoyee" || item.outcome === "accuse";
			if (filter === "followup")
				return (
					(item.outcome === "envoyee" || item.outcome === "accuse") &&
					(item.followUpAt ?? Infinity) <= now
				);
			if (filter === "progress")
				return ["test", "entretien", "offre"].includes(item.outcome ?? "");
			if (filter === "closed")
				return ["refus", "abandon"].includes(item.outcome ?? "");
			if (filter === "todo") return !item.sentAt;
			return true;
		});
	}, [data, filter, query, now]);
	const unlinked = (mails ?? []).filter((mail) => !mail.applicationId);
	const current = data?.rows.find((item) => item._id === open) ?? null;

	function exportCsv() {
		const header = [
			"Entreprise",
			"Poste",
			"Lien",
			"Envoyée le",
			"Canal",
			"Statut",
			"Mis à jour le",
			"Relance",
			"Notes",
		];
		const lines = (data?.rows ?? []).map((item) => [
			item.company,
			item.jobTitle,
			item.url ?? "",
			item.sentAt ? day.format(item.sentAt) : "",
			item.sentVia ?? "",
			label(item.outcome),
			item.outcomeAt ? day.format(item.outcomeAt) : "",
			item.followUpAt ? day.format(item.followUpAt) : "",
			item.notes,
		]);
		const csv = [header, ...lines]
			.map((line) =>
				line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"),
			)
			.join("\r\n");
		const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = `candidatures-${new Date().toISOString().slice(0, 10)}.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	return (
		<div>
			<SectionHeader
				title="Suivi"
				description={
					data?.mail ? (
						data.mail.lastError ? (
							<span className="text-destructive">
								Boîte mail : {data.mail.lastError}
							</span>
						) : (
							<>
								Statuts mis à jour depuis ta boîte mail (lecture seule) ·
								vérifiée {timeAgo(data.mail.lastCheckAt ?? undefined)}
							</>
						)
					) : (
						"Toutes tes candidatures, et ce qu’il s’est passé depuis."
					)
				}
				actions={
					<>
						<Button
							size="sm"
							variant="outline"
							onClick={exportCsv}
							disabled={!data?.rows.length}
						>
							<Download /> Exporter (Excel)
						</Button>
						<Button size="sm" onClick={() => setAdding(true)}>
							<Plus /> Ajouter
						</Button>
					</>
				}
			/>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
				{(
					[
						["Envoyées", data?.stats.sent],
						["En attente", data?.stats.waiting],
						["À relancer", data?.stats.followUps],
						["Tests / entretiens", data?.stats.interviews],
						["Offres", data?.stats.offers],
						["Refus", data?.stats.refused],
						[
							"Taux de réponse",
							data ? `${data.stats.responseRate} %` : undefined,
						],
					] as const
				).map(([title, value]) => (
					<Card key={title} className="gap-1 px-4 py-3">
						<span className="text-xs text-muted-foreground">{title}</span>
						{value === undefined ? (
							<Skeleton className="h-7 w-10" />
						) : (
							<span className="tabular text-xl font-semibold">{value}</span>
						)}
					</Card>
				))}
			</div>

			<Card className="mt-6 gap-0 overflow-hidden py-0">
				<div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
					<InputGroup className="sm:max-w-xs">
						<InputGroupAddon>
							<Search />
						</InputGroupAddon>
						<InputGroupInput
							placeholder="Entreprise ou poste…"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</InputGroup>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={filter}
						onValueChange={(value) => value && setFilter(value)}
						className="flex-wrap sm:ml-auto"
					>
						<ToggleGroupItem value="all" className="px-3">
							Toutes
						</ToggleGroupItem>
						<ToggleGroupItem value="waiting" className="px-3">
							En attente
						</ToggleGroupItem>
						<ToggleGroupItem value="followup" className="px-3">
							À relancer
						</ToggleGroupItem>
						<ToggleGroupItem value="progress" className="px-3">
							En cours
						</ToggleGroupItem>
						<ToggleGroupItem value="closed" className="px-3">
							Terminées
						</ToggleGroupItem>
						<ToggleGroupItem value="todo" className="px-3">
							À envoyer
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
				{data === undefined ? (
					<Skeleton className="m-4 h-40" />
				) : rows.length === 0 ? (
					<Empty className="py-14">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Inbox />
							</EmptyMedia>
							<EmptyTitle>Rien ici pour l’instant</EmptyTitle>
							<EmptyDescription>
								Les candidatures envoyées via l’extension ou par email arrivent
								ici automatiquement. « Ajouter » pour celles faites ailleurs.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="pl-4">Entreprise · poste</TableHead>
								<TableHead>Envoyée</TableHead>
								<TableHead>Statut</TableHead>
								<TableHead className="hidden lg:table-cell">
									Dernier signal
								</TableHead>
								<TableHead className="pr-4 text-right">Relance</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((item) => {
								const overdue =
									(item.outcome === "envoyee" || item.outcome === "accuse") &&
									item.followUpAt !== null &&
									item.followUpAt <= now;
								return (
									<TableRow
										key={item._id}
										className="cursor-pointer"
										onClick={() => setOpen(item._id)}
									>
										<TableCell className="max-w-[320px] pl-4">
											<p className="truncate text-xs text-muted-foreground">
												{item.company}
											</p>
											<p className="truncate font-medium">{item.jobTitle}</p>
										</TableCell>
										<TableCell className="whitespace-nowrap text-sm">
											{item.sentAt ? day.format(item.sentAt) : "—"}
											{item.sentVia && (
												<span className="block text-xs text-muted-foreground">
													{item.sentVia === "portail" ? "site" : item.sentVia}
												</span>
											)}
										</TableCell>
										<TableCell onClick={(event) => event.stopPropagation()}>
											{item.sentAt ? (
												<Select
													value={item.outcome ?? "envoyee"}
													onValueChange={(outcome) =>
														void setOutcome({ id: item._id, outcome }).then(
															() => toast.success(`Statut : ${label(outcome)}`),
														)
													}
												>
													<SelectTrigger
														size="sm"
														className={cn(
															"h-7 w-[170px] text-xs",
															tone(item.outcome),
														)}
													>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{OUTCOMES.map((outcome) => (
															<SelectItem key={outcome.id} value={outcome.id}>
																{outcome.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											) : (
												<Button
													size="sm"
													variant="outline"
													className="h-7 text-xs"
													onClick={() =>
														void markSent({ id: item._id }).then(() =>
															toast.success("Marquée comme envoyée"),
														)
													}
												>
													Marquer envoyée
												</Button>
											)}
										</TableCell>
										<TableCell className="hidden max-w-[280px] lg:table-cell">
											{item.lastEvent ? (
												<div className="text-xs">
													<p className="flex items-center gap-1 text-muted-foreground">
														{item.lastEvent.source === "email" ? (
															<Mail className="size-3" />
														) : item.lastEvent.source === "extension" ? (
															<MousePointerClick className="size-3" />
														) : (
															<PencilLine className="size-3" />
														)}
														{SOURCE[item.lastEvent.source] ??
															item.lastEvent.source}{" "}
														· {timeAgo(item.lastEvent.at)}
													</p>
													<p className="truncate">
														{item.lastEvent.subject ??
															label(item.lastEvent.type)}
													</p>
												</div>
											) : (
												<span className="text-xs text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell
											className={cn(
												"pr-4 text-right text-sm whitespace-nowrap",
												overdue && "font-medium text-warning",
											)}
										>
											{item.followUpAt &&
											(item.outcome === "envoyee" || item.outcome === "accuse")
												? day.format(item.followUpAt)
												: "—"}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</Card>

			{unlinked.length > 0 && (
				<Card className="mt-6 gap-3 px-6">
					<h3 className="flex items-center gap-2 text-sm font-semibold">
						<Mail className="size-4" /> Emails de recrutement non reliés
					</h3>
					<p className="text-xs text-muted-foreground">
						Détectés dans ta boîte, sans candidature correspondante sûre.
						Relie-les pour mettre le statut à jour.
					</p>
					<ul className="divide-y">
						{unlinked.slice(0, 10).map((mail) => (
							<li
								key={mail._id}
								className="flex flex-wrap items-center gap-3 py-2.5"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{mail.subject}</p>
									<p className="truncate text-xs text-muted-foreground">
										{mail.from} · {dayTime.format(mail.receivedAt)} ·{" "}
										{label(mail.category)}
									</p>
								</div>
								<Select
									onValueChange={(id) =>
										void reassign({
											id: mail._id,
											applicationId: id as Id<"applications">,
										}).then(() => toast.success("Email relié"))
									}
								>
									<SelectTrigger size="sm" className="w-[220px] text-xs">
										<SelectValue placeholder="Relier à…" />
									</SelectTrigger>
									<SelectContent>
										{(data?.rows ?? [])
											.filter((item) => item.sentAt)
											.map((item) => (
												<SelectItem key={item._id} value={item._id}>
													{item.company} · {item.jobTitle}
												</SelectItem>
											))}
									</SelectContent>
								</Select>
							</li>
						))}
					</ul>
				</Card>
			)}

			<DetailSheet row={current} onClose={() => setOpen(null)} />
			<AddDialog open={adding} onOpenChange={setAdding} />
		</div>
	);
}

function DetailSheet({
	row,
	onClose,
}: {
	row: Row | null;
	onClose: () => void;
}) {
	const setNotes = useMutation(api.tracking.setNotes);
	const setFollowUp = useMutation(api.tracking.setFollowUp);
	return (
		<Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="w-full gap-0 sm:max-w-lg">
				{row && (
					<>
						<SheetHeader className="border-b pr-12">
							<SheetDescription>{row.company}</SheetDescription>
							<SheetTitle className="leading-snug">{row.jobTitle}</SheetTitle>
							<div className="mt-1 flex flex-wrap gap-2">
								<Badge variant="outline" className={tone(row.outcome)}>
									{label(row.outcome)}
								</Badge>
								{row.url && (
									<a
										href={row.url}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
									>
										Offre <ArrowUpRight className="size-3" />
									</a>
								)}
							</div>
						</SheetHeader>
						<ScrollArea className="min-h-0 flex-1">
							<div className="grid gap-6 p-4">
								<div className="grid gap-1.5">
									<Label className="text-xs text-muted-foreground">
										Relance prévue le
									</Label>
									<Input
										type="date"
										defaultValue={
											row.followUpAt
												? new Date(row.followUpAt).toISOString().slice(0, 10)
												: ""
										}
										onChange={(event) =>
											void setFollowUp({
												id: row._id,
												followUpAt: event.target.value
													? new Date(`${event.target.value}T09:00:00`).getTime()
													: null,
											})
										}
										className="w-48"
									/>
								</div>
								<div className="grid gap-1.5">
									<Label className="text-xs text-muted-foreground">Notes</Label>
									<Textarea
										key={row._id}
										rows={4}
										defaultValue={row.notes}
										placeholder="Contact, ressenti, prochaines étapes…"
										onBlur={(event) =>
											event.target.value !== row.notes &&
											void setNotes({
												id: row._id,
												notes: event.target.value,
											}).then(() => toast.success("Notes enregistrées"))
										}
									/>
								</div>
								<div>
									<p className="mb-2 text-xs text-muted-foreground">
										Historique
									</p>
									<ol className="relative ml-2 border-l pl-4">
										{[...row.events].reverse().map((event) => (
											<li
												key={`${event.at}-${event.type}-${event.source}`}
												className="mb-4"
											>
												<span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border bg-background" />
												<p className="text-sm font-medium">
													{label(event.type)}{" "}
													<span className="font-normal text-muted-foreground">
														· {SOURCE[event.source] ?? event.source} ·{" "}
														{dayTime.format(event.at)}
													</span>
												</p>
												{event.subject && (
													<p className="text-sm">{event.subject}</p>
												)}
												{event.from && (
													<p className="text-xs text-muted-foreground">
														{event.from}
													</p>
												)}
												{event.snippet && (
													<p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
														{event.snippet}
													</p>
												)}
											</li>
										))}
										{row.events.length === 0 && (
											<li className="text-sm text-muted-foreground">
												Pas encore d’événement.
											</li>
										)}
									</ol>
								</div>
							</div>
						</ScrollArea>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}

function AddDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const addManual = useMutation(api.tracking.addManual);
	const [company, setCompany] = useState("");
	const [jobTitle, setJobTitle] = useState("");
	const [url, setUrl] = useState("");
	const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
	async function submit() {
		try {
			await addManual({
				company,
				jobTitle,
				url: url || undefined,
				sentAt: new Date(`${date}T12:00:00`).getTime(),
			});
			toast.success("Candidature ajoutée au suivi");
			setCompany("");
			setJobTitle("");
			setUrl("");
			onOpenChange(false);
		} catch (error) {
			toast.error("Ajout impossible", {
				description:
					error instanceof Error
						? error.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]
						: undefined,
			});
		}
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Ajouter une candidature</DialogTitle>
					<DialogDescription>
						Pour une candidature faite en dehors de Market Radar.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3">
					<Input
						placeholder="Entreprise"
						value={company}
						onChange={(event) => setCompany(event.target.value)}
					/>
					<Input
						placeholder="Poste"
						value={jobTitle}
						onChange={(event) => setJobTitle(event.target.value)}
					/>
					<Input
						placeholder="Lien de l’offre (facultatif)"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
					/>
					<div className="grid gap-1.5">
						<Label className="text-xs text-muted-foreground">Envoyée le</Label>
						<Input
							type="date"
							value={date}
							onChange={(event) => setDate(event.target.value)}
							className="w-48"
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Annuler
					</Button>
					<Button
						onClick={submit}
						disabled={!company.trim() || !jobTitle.trim()}
					>
						Ajouter
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
