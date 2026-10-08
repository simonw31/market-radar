import { useMutation, useQuery } from "convex/react";
import {
	ArrowUpRight,
	BriefcaseBusiness,
	ChevronLeft,
	ChevronRight,
	FileText,
	MapPin,
	Search,
	SearchX,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
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
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	PriorityBadge,
	ScorePill,
	SectionHeader,
	timeAgo,
	useDebounced,
} from "./shared";

const contractOptions = ["Stage", "Alternance", "CDI", "CDD", "VIE"];

export function RadarView({
	profileId,
	onOpenApplication,
}: {
	profileId?: string;
	onOpenApplication: (id: string) => void;
}) {
	const [search, setSearch] = useState("");
	const [priority, setPriority] = useState("all");
	const [contract, setContract] = useState("all");
	const [sort, setSort] = useState("score");
	const [showAll, setShowAll] = useState(false);
	const [justPublished, setJustPublished] = useState(false);
	// The page resets to 0 whenever a filter changes.
	const [paging, setPaging] = useState({ key: "", page: 0 });
	const [openJob, setOpenJob] = useState<Id<"jobs"> | null>(null);
	const debouncedSearch = useDebounced(search);
	const filterKey = [
		profileId,
		debouncedSearch,
		priority,
		contract,
		sort,
		showAll,
		justPublished,
	].join("|");
	const page = paging.key === filterKey ? paging.page : 0;
	const setPage = (next: number) => setPaging({ key: filterKey, page: next });
	const overview = useQuery(api.jobs.overview);
	const data = useQuery(
		api.jobs.radar,
		profileId
			? {
					profileId,
					search: debouncedSearch,
					priority,
					contract,
					sort,
					scope: showAll ? "all" : "relevant",
					justPublished,
					page,
					pageSize: 20,
				}
			: "skip",
	);
	// Keep the previous page on screen while the next one loads.
	const [shown, setShown] = useState(data);
	useEffect(() => {
		if (data) setShown(data);
	}, [data]);

	const lastRun =
		overview?.latestRun?.finishedAt ?? overview?.latestRun?.startedAt;

	return (
		<div>
			<SectionHeader
				title="Radar"
				description={
					shown ? (
						<>
							{shown.counts.relevant} offres pertinentes pour{" "}
							<span className="text-foreground">{shown.profile.name}</span> ·
							mis à jour {timeAgo(lastRun)}
						</>
					) : (
						"Chargement du radar…"
					)
				}
			/>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Kpi
					label="Pertinentes"
					value={shown?.counts.relevant}
					hint={`sur ${shown?.counts.eligible ?? "…"} offres éligibles`}
				/>
				<Kpi
					label="Priorité P1"
					value={shown?.counts.p1}
					hint={`${shown?.counts.p2 ?? "…"} en P2`}
				/>
				<Kpi
					label="Nouvelles"
					value={shown?.counts.fresh}
					hint="depuis 3 jours"
				/>
				<Kpi
					label="Offres suivies"
					value={overview?.stats.total}
					hint={`${overview?.stats.connected ?? "…"} sources actives`}
				/>
			</div>

			<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
				<Card className="gap-0 overflow-hidden py-0">
					<div className="flex flex-col gap-3 border-b p-4">
						<div className="flex flex-col gap-3 sm:flex-row">
							<InputGroup className="sm:max-w-sm">
								<InputGroupAddon>
									<Search />
								</InputGroupAddon>
								<InputGroupInput
									placeholder="Poste, entreprise, compétence…"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									aria-label="Rechercher une offre"
								/>
							</InputGroup>
							<div className="flex flex-wrap items-center gap-2 sm:ml-auto">
								<Select value={contract} onValueChange={setContract}>
									<SelectTrigger
										size="sm"
										className="w-[150px]"
										aria-label="Contrat"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">Tous contrats</SelectItem>
										{contractOptions.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Select value={sort} onValueChange={setSort}>
									<SelectTrigger
										size="sm"
										className="w-[160px]"
										aria-label="Tri"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="score">Meilleur score</SelectItem>
										<SelectItem value="recent">Plus récentes</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<ToggleGroup
								type="single"
								variant="outline"
								size="sm"
								value={priority}
								onValueChange={(value) => value && setPriority(value)}
								aria-label="Priorité"
							>
								<ToggleGroupItem value="all" className="px-3">
									Toutes
								</ToggleGroupItem>
								<ToggleGroupItem value="P1" className="px-3">
									P1
								</ToggleGroupItem>
								<ToggleGroupItem value="P2" className="px-3">
									P2
								</ToggleGroupItem>
								<ToggleGroupItem value="P3" className="px-3">
									P3
								</ToggleGroupItem>
							</ToggleGroup>
							<Button
								size="sm"
								variant={justPublished ? "default" : "outline"}
								onClick={() => setJustPublished((value) => !value)}
								className="gap-1.5"
							>
								<span
									className={cn(
										"size-1.5 rounded-full",
										justPublished ? "bg-background" : "bg-success",
									)}
								/>
								Vient de sortir
								{shown && (
									<span className="tabular opacity-70">
										{shown.counts.justPublished}
									</span>
								)}
							</Button>
							<div className="flex items-center gap-2 sm:ml-auto">
								<Switch
									id="show-all"
									checked={showAll}
									onCheckedChange={setShowAll}
								/>
								<Label
									htmlFor="show-all"
									className="font-normal text-muted-foreground"
								>
									Inclure les offres peu pertinentes
								</Label>
							</div>
						</div>
					</div>

					{!shown ? (
						<JobListSkeleton />
					) : shown.items.length === 0 ? (
						<Empty className="py-16">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<SearchX />
								</EmptyMedia>
								<EmptyTitle>Aucune offre pour ces filtres</EmptyTitle>
								<EmptyDescription>
									Élargis la recherche, change de priorité ou inclus les offres
									peu pertinentes.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<ul
							className={cn(
								"divide-y transition-opacity",
								data === undefined && "opacity-60",
							)}
						>
							{shown.items.map((job) => (
								<li key={job._id}>
									<button
										type="button"
										onClick={() => setOpenJob(job._id)}
										className="group flex w-full items-start gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="truncate text-sm text-muted-foreground">
													{job.displayCompany}
												</span>
												{job.justPublished ? (
													<span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 text-[10px] font-semibold text-success">
														<span className="size-1 rounded-full bg-success" />
														Vient de sortir
													</span>
												) : (
													job.isNew && (
														<span className="rounded-full bg-info-soft px-1.5 text-[10px] font-medium text-info">
															Nouveau
														</span>
													)
												)}
											</div>
											<p className="mt-0.5 font-medium leading-snug group-hover:underline group-hover:underline-offset-4">
												{job.title}
											</p>
											<div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
												<span className="inline-flex items-center gap-1">
													<BriefcaseBusiness className="size-3" />
													{job.contractKind === "Autre"
														? job.contractType
														: job.contractKind}
												</span>
												<span className="inline-flex min-w-0 items-center gap-1">
													<MapPin className="size-3 shrink-0" />
													<span className="truncate">{job.location}</span>
												</span>
												{job.requiredExperienceYears !== undefined && (
													<span>{job.requiredExperienceYears}+ ans d’exp.</span>
												)}
												{job.marketScore >= 4 && <span>Marchés</span>}
												{job.categories.includes("Support Front Office") && (
													<span>Support front</span>
												)}
											</div>
											{(job.matches.length > 0 || job.skills.length > 0) && (
												<div className="mt-2 flex flex-wrap gap-1">
													{job.matches.map((match) => (
														<Badge
															key={`m-${match}`}
															className="h-5 rounded-full border-transparent bg-foreground/90 px-2 text-[11px] font-normal text-background"
														>
															{match}
														</Badge>
													))}
													{job.skills.slice(0, 4).map((skill) => (
														<Badge
															key={skill}
															variant="outline"
															className="h-5 rounded-full px-2 text-[11px] font-normal text-muted-foreground"
														>
															{skill}
														</Badge>
													))}
												</div>
											)}
										</div>
										<div className="flex shrink-0 flex-col items-end gap-1.5">
											<ScorePill score={job.profileScore} />
											<PriorityBadge priority={job.profilePriority} />
										</div>
									</button>
								</li>
							))}
						</ul>
					)}

					{shown && shown.total > 0 && (
						<div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
							<span className="tabular">
								{shown.page * shown.pageSize + 1}–
								{Math.min(shown.total, (shown.page + 1) * shown.pageSize)} sur{" "}
								{shown.total}
							</span>
							<div className="flex items-center gap-1">
								<Button
									variant="outline"
									size="icon-sm"
									disabled={shown.page === 0}
									onClick={() => setPage(shown.page - 1)}
									aria-label="Page précédente"
								>
									<ChevronLeft />
								</Button>
								<span className="tabular px-2">
									{shown.page + 1} / {shown.pages}
								</span>
								<Button
									variant="outline"
									size="icon-sm"
									disabled={shown.page >= shown.pages - 1}
									onClick={() => setPage(shown.page + 1)}
									aria-label="Page suivante"
								>
									<ChevronRight />
								</Button>
							</div>
						</div>
					)}
				</Card>

				<aside className="flex flex-col gap-6">
					<Card className="gap-4">
						<CardHeader>
							<CardTitle className="text-sm">Compétences demandées</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							{!shown
								? Array.from({ length: 6 }, (_, index) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
										<Skeleton key={index} className="h-6" />
									))
								: shown.skills.slice(0, 10).map((skill) => (
										<button
											type="button"
											key={skill.name}
											onClick={() => setSearch(skill.name)}
											className="group text-left"
										>
											<div className="flex items-baseline justify-between text-sm">
												<span className="group-hover:underline group-hover:underline-offset-4">
													{skill.name}
												</span>
												<span className="tabular text-xs text-muted-foreground">
													{skill.count}
												</span>
											</div>
											<div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
												<div
													className="h-full rounded-full bg-foreground/70"
													style={{
														width: `${Math.max(6, (skill.count / (shown.skills[0]?.count || 1)) * 100)}%`,
													}}
												/>
											</div>
										</button>
									))}
							{shown && shown.skills.length === 0 && (
								<p className="text-sm text-muted-foreground">
									Pas encore assez d’offres pertinentes.
								</p>
							)}
						</CardContent>
					</Card>
					<Card className="gap-4">
						<CardHeader>
							<CardTitle className="text-sm">
								Entreprises qui recrutent
							</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-2">
							{shown?.companies.map((company) => (
								<button
									type="button"
									key={company.name}
									onClick={() => setSearch(company.name)}
									className="flex items-center justify-between text-left text-sm hover:underline hover:underline-offset-4"
								>
									<span className="truncate">{company.name}</span>
									<span className="tabular text-xs text-muted-foreground">
										{company.count}
									</span>
								</button>
							))}
						</CardContent>
					</Card>
				</aside>
			</div>

			<JobSheet
				jobId={openJob}
				profileId={profileId}
				onClose={() => setOpenJob(null)}
				onOpenApplication={onOpenApplication}
			/>
		</div>
	);
}

function Kpi({
	label,
	value,
	hint,
}: {
	label: string;
	value?: number;
	hint: string;
}) {
	return (
		<Card className="gap-1 px-4 py-4">
			<span className="text-xs text-muted-foreground">{label}</span>
			{value === undefined ? (
				<Skeleton className="h-8 w-16" />
			) : (
				<span className="tabular text-2xl font-semibold tracking-tight">
					{value.toLocaleString("fr-FR")}
				</span>
			)}
			<span className="truncate text-xs text-muted-foreground">{hint}</span>
		</Card>
	);
}

function JobListSkeleton() {
	return (
		<div className="divide-y">
			{Array.from({ length: 6 }, (_, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
				<div key={index} className="flex gap-4 px-4 py-4">
					<div className="flex-1 space-y-2">
						<Skeleton className="h-3 w-32" />
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-3 w-1/2" />
					</div>
					<Skeleton className="size-9 rounded-full" />
				</div>
			))}
		</div>
	);
}

function ScoreBar({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<div className="flex justify-between text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span className="tabular">{value}/5</span>
			</div>
			<div className="mt-1 grid grid-cols-5 gap-1">
				{Array.from({ length: 5 }, (_, index) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed scale
						key={index}
						className={cn(
							"h-1.5 rounded-full",
							index < value ? "bg-foreground/80" : "bg-muted",
						)}
					/>
				))}
			</div>
		</div>
	);
}

function JobSheet({
	jobId,
	profileId,
	onClose,
	onOpenApplication,
}: {
	jobId: Id<"jobs"> | null;
	profileId?: string;
	onClose: () => void;
	onOpenApplication: (id: string) => void;
}) {
	const job = useQuery(api.jobs.detail, jobId ? { jobId, profileId } : "skip");
	const createApplication = useMutation(api.applications.create);
	const [starting, setStarting] = useState(false);

	async function prepare() {
		if (!jobId) return;
		setStarting(true);
		try {
			const id = await createApplication({ jobId, profileId });
			toast.success("Candidature en préparation", {
				description:
					"L’IA locale assemble CV et lettre (1 à 2 minutes). Rien n’est envoyé sans ta validation.",
			});
			onClose();
			onOpenApplication(id);
		} catch (error) {
			toast.error("Impossible de préparer la candidature", {
				description:
					error instanceof Error
						? error.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]
						: undefined,
			});
		} finally {
			setStarting(false);
		}
	}

	return (
		<Sheet open={jobId !== null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="w-full gap-0 sm:max-w-xl">
				{!job ? (
					<div className="space-y-3 p-6">
						<Skeleton className="h-4 w-40" />
						<Skeleton className="h-7 w-3/4" />
						<Skeleton className="h-40 w-full" />
					</div>
				) : (
					<>
						<SheetHeader className="gap-1.5 border-b pr-12">
							<SheetDescription>{job.displayCompany}</SheetDescription>
							<SheetTitle className="text-lg leading-snug">
								{job.title}
							</SheetTitle>
							<div className="mt-2 flex flex-wrap items-center gap-1.5">
								<PriorityBadge priority={job.profilePriority} />
								<Badge variant="secondary" className="font-normal">
									{job.contractKind === "Autre"
										? job.contractType
										: job.contractKind}
								</Badge>
								<Badge variant="secondary" className="font-normal">
									{job.location}
								</Badge>
								{job.requiredExperienceYears !== undefined && (
									<Badge variant="secondary" className="font-normal">
										{job.requiredExperienceYears}+ ans d’expérience
									</Badge>
								)}
								{!job.eligible && (
									<Badge variant="destructive">Hors critères du profil</Badge>
								)}
							</div>
						</SheetHeader>
						<ScrollArea className="min-h-0 flex-1">
							<div className="space-y-6 p-4">
								<div className="flex items-center gap-4">
									<ScorePill
										score={job.profileScore}
										className="h-12 min-w-14 text-lg"
									/>
									<div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
										<ScoreBar label="Tech" value={job.techScore} />
										<ScoreBar label="Marchés" value={job.marketScore} />
									</div>
								</div>
								{job.matches.length > 0 && (
									<div>
										<h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
											<Sparkles className="size-3.5" /> Correspond à tes
											mots-clés
										</h3>
										<div className="flex flex-wrap gap-1">
											{job.matches.map((match) => (
												<Badge key={match} className="rounded-full font-normal">
													{match}
												</Badge>
											))}
										</div>
									</div>
								)}
								{job.skills.length > 0 && (
									<div>
										<h3 className="mb-2 text-sm font-medium">
											Compétences détectées
										</h3>
										<div className="flex flex-wrap gap-1">
											{job.skills.map((skill) => (
												<Badge
													key={skill}
													variant="outline"
													className="rounded-full font-normal"
												>
													{skill}
												</Badge>
											))}
										</div>
									</div>
								)}
								<Separator />
								<div>
									<h3 className="mb-2 text-sm font-medium">Description</h3>
									<p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
										{job.description || "Description non disponible."}
									</p>
								</div>
							</div>
						</ScrollArea>
						<SheetFooter className="flex-row gap-2 border-t">
							<Button asChild variant="outline" className="flex-1">
								<a href={job.url} target="_blank" rel="noreferrer">
									Voir l’annonce <ArrowUpRight />
								</a>
							</Button>
							<Button className="flex-1" onClick={prepare} disabled={starting}>
								<FileText /> Préparer la candidature
							</Button>
						</SheetFooter>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
