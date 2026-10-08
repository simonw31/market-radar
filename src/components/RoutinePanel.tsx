import { useMutation, useQuery } from "convex/react";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	CircleDashed,
	Copy,
	ExternalLink,
	Eye,
	LoaderCircle,
	Plus,
	Search,
	Send,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import { buildReport, type ReportData } from "../../convex/lib/reportTemplate";
import { CvPanel } from "./CvPanel";
import { CompanyPicker, TagInput } from "./inputs";
import {
	PriorityBadge,
	ProfileDot,
	SectionHeader,
	scheduleLabel,
	timeAgo,
	useDebounced,
	weekdayNames,
} from "./shared";

type Profile = {
	id: string;
	name: string;
	email: string;
	emails: string[];
	enabled: boolean;
	frequency: string;
	weekday: number;
	hour: number;
	contractTypes: string[];
	targetKeywords: string[];
	excludedKeywords: string[];
	techRoles: string;
	marketFocus: string;
	ownerEmail?: string;
	maxExperienceYears: number;
	companyFilterMode: string;
	companies: string[];
	weights: { tech: number; market: number; fit: number };
	lastReportAt?: number;
	lastScheduleKey?: string;
};

const CONTRACTS = ["Stage", "Alternance", "CDI", "CDD", "VIE"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const presets: Array<{
	label: string;
	description: string;
	make: () => Omit<Profile, "id" | "email" | "emails">;
}> = [
	{
		label: "Front Office · Opérations",
		description: "CDI, onboarding, KYC, relation client, marchés",
		make: () => ({
			name: "Front Office · CDI",
			enabled: true,
			frequency: "daily",
			weekday: 1,
			hour: 7,
			contractTypes: ["CDI"],
			targetKeywords: [
				"front office",
				"onboarding",
				"KYC",
				"client",
				"markets",
				"middle office",
				"sales",
				"opérations",
			],
			excludedKeywords: [],
			techRoles: "exclude",
			marketFocus: "support",
			maxExperienceYears: 2,
			companyFilterMode: "all",
			companies: [],
			weights: { tech: 10, market: 55, fit: 35 },
		}),
	},
	{
		label: "Tech & Data · Alternance",
		description: "IT, data, SI, projet, marchés",
		make: () => ({
			name: "Tech & Data · Alternance",
			enabled: true,
			frequency: "daily",
			weekday: 1,
			hour: 6,
			contractTypes: ["Stage", "Alternance"],
			targetKeywords: [
				"data",
				"IT",
				"systèmes d’information",
				"chef de projet",
				"business analyst",
			],
			excludedKeywords: [],
			techRoles: "include",
			marketFocus: "all",
			maxExperienceYears: 2,
			companyFilterMode: "all",
			companies: [],
			weights: { tech: 50, market: 30, fit: 20 },
		}),
	},
	{
		label: "Conseil & PMO",
		description: "Transformation, PMO, AMOA, gestion de projet",
		make: () => ({
			name: "Conseil & PMO",
			enabled: true,
			frequency: "weekly",
			weekday: 1,
			hour: 7,
			contractTypes: ["CDI", "Stage"],
			targetKeywords: [
				"PMO",
				"consultant",
				"transformation",
				"AMOA",
				"gestion de projet",
			],
			excludedKeywords: [],
			techRoles: "include",
			marketFocus: "all",
			maxExperienceYears: 2,
			companyFilterMode: "all",
			companies: [],
			weights: { tech: 30, market: 20, fit: 50 },
		}),
	},
];

function blank(): Omit<Profile, "id" | "email" | "emails"> {
	return {
		name: "Nouveau profil",
		enabled: true,
		frequency: "weekly",
		weekday: 1,
		hour: 7,
		contractTypes: ["CDI"],
		targetKeywords: [],
		excludedKeywords: [],
		techRoles: "include",
		marketFocus: "all",
		maxExperienceYears: 2,
		companyFilterMode: "all",
		companies: [],
		weights: { tech: 34, market: 33, fit: 33 },
	};
}

function problems(profile: Profile) {
	const list: string[] = [];
	if (!profile.name.trim()) list.push("Nom manquant");
	if (!profile.emails.length) list.push("Ajoute au moins un destinataire");
	if (profile.emails.some((email) => !EMAIL.test(email)))
		list.push("Adresse email invalide");
	if (!profile.contractTypes.length) list.push("Choisis au moins un contrat");
	const { tech, market, fit } = profile.weights;
	if (tech + market + fit === 0) list.push("Les pondérations sont toutes à 0");
	return list;
}

export function RoutinePanel({
	selectedId,
	onSelect,
}: {
	selectedId?: string;
	onSelect: (id: string) => void;
}) {
	const settings = useQuery(api.settings.get);
	const overview = useQuery(api.jobs.overview);
	const operations = useQuery(api.operations.overview);
	const saveProfiles = useMutation(api.settings.saveProfiles);
	const requestRoutine = useMutation(api.operations.requestRoutine);
	const [profiles, setProfiles] = useState<Profile[]>([]);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [confirmSend, setConfirmSend] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [preview, setPreview] = useState(false);
	const loaded = useRef(false);

	// Server updates (a report was sent, a schedule claimed…) must not erase
	// edits in progress: only resync while the form is clean.
	useEffect(() => {
		if (!settings || (loaded.current && dirty)) return;
		loaded.current = true;
		setProfiles(settings.profiles as Profile[]);
	}, [settings, dirty]);

	const selected =
		profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
	const owner = selected?.emails.includes(selected.ownerEmail ?? "")
		? (selected.ownerEmail as string)
		: (selected?.emails[0] ?? "");

	const issues = selected ? problems(selected) : [];
	const allIssues = profiles.flatMap((profile) =>
		problems(profile).map((issue) => `${profile.name} : ${issue}`),
	);
	const runActive = Boolean(
		selected &&
			operations?.scan?.profileId === selected.id &&
			["queued", "running"].includes(operations.scan.status),
	);

	function patch(next: Partial<Profile>) {
		if (!selected) return;
		setProfiles((list) =>
			list.map((profile) =>
				profile.id === selected.id ? { ...profile, ...next } : profile,
			),
		);
		setDirty(true);
	}

	function add(
		base: Omit<Profile, "id" | "email" | "emails" | "ownerEmail">,
		emails: string[] = [],
	) {
		const id = `profil-${Date.now()}`;
		setProfiles((list) => [
			...list,
			{ ...base, id, emails, email: emails[0] ?? "", ownerEmail: emails[0] },
		]);
		setDirty(true);
		onSelect(id);
	}

	async function save() {
		if (allIssues.length) {
			toast.error("Le formulaire contient des erreurs", {
				description: allIssues[0],
			});
			return false;
		}
		setSaving(true);
		try {
			await saveProfiles({
				profiles: profiles.map((profile) => ({
					...profile,
					email: profile.emails[0] ?? "",
					ownerEmail: profile.emails.includes(profile.ownerEmail ?? "")
						? profile.ownerEmail
						: profile.emails[0],
				})),
			});
			setDirty(false);
			toast.success("Profils enregistrés");
			return true;
		} catch (error) {
			toast.error("Enregistrement impossible", {
				description:
					error instanceof Error
						? error.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]
						: undefined,
			});
			return false;
		} finally {
			setSaving(false);
		}
	}

	function discard() {
		if (!settings) return;
		setProfiles(settings.profiles as Profile[]);
		setDirty(false);
	}

	async function sendNow() {
		if (!selected) return;
		if (dirty && !(await save())) return;
		try {
			await requestRoutine({
				profileId: selected.id,
				totalSources: overview?.stats.connected ?? 40,
			});
			toast.success("Routine ajoutée à la file", {
				description: "Suis la collecte et l’envoi dans l’onglet Collecte.",
			});
		} catch (error) {
			toast.error("Impossible de lancer la routine", {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	}

	if (!settings || !selected) {
		return (
			<div className="grid gap-6 lg:grid-cols-[260px_1fr]">
				<Skeleton className="h-64" />
				<Skeleton className="h-[600px]" />
			</div>
		);
	}

	return (
		<div className="pb-24">
			<SectionHeader
				title="Profils"
				description="Chaque personne a ses propres critères, son scoring et son rapport email. La collecte reste commune."
			/>

			<div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
				<div className="flex flex-col gap-3">
					<Card className="gap-0 py-2">
						{profiles.map((profile) => (
							<button
								type="button"
								key={profile.id}
								onClick={() => onSelect(profile.id)}
								className={cn(
									"mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted",
									profile.id === selected.id && "bg-muted",
								)}
							>
								<ProfileDot name={profile.name} className="size-8 text-xs" />
								<span className="min-w-0 flex-1">
									<span className="block truncate text-sm font-medium">
										{profile.name}
									</span>
									<span className="block truncate text-xs text-muted-foreground">
										{profile.enabled ? scheduleLabel(profile) : "En pause"}
									</span>
								</span>
								{problems(profile).length > 0 && (
									<AlertTriangle className="size-4 text-warning" />
								)}
							</button>
						))}
					</Card>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" className="w-full">
								<Plus /> Nouveau profil
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-64" align="start">
							<DropdownMenuLabel>Partir d’un modèle</DropdownMenuLabel>
							{presets.map((preset) => (
								<DropdownMenuItem
									key={preset.label}
									onSelect={() => add(preset.make())}
									className="flex-col items-start gap-0"
								>
									<span>{preset.label}</span>
									<span className="text-xs text-muted-foreground">
										{preset.description}
									</span>
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => add(blank())}>
								<Plus /> Profil vierge
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									const {
										id: _id,
										email: _email,
										emails: _emails,
										lastReportAt: _r,
										lastScheduleKey: _k,
										...rest
									} = selected;
									add({ ...rest, name: `${selected.name} (copie)` });
								}}
							>
								<Copy /> Dupliquer « {selected.name} »
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="flex min-w-0 flex-col gap-6">
					<Card>
						<CardHeader>
							<CardTitle>Identité et envoi</CardTitle>
							<CardDescription>
								Le rapport de veille part automatiquement. Les candidatures,
								jamais.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-5 sm:grid-cols-2">
							<Field label="Nom du profil" htmlFor="profile-name">
								<Input
									id="profile-name"
									value={selected.name}
									onChange={(event) => patch({ name: event.target.value })}
									aria-invalid={!selected.name.trim()}
								/>
							</Field>
							<Field
								label="Rapport actif"
								hint={
									selected.lastReportAt
										? `Dernier envoi ${timeAgo(selected.lastReportAt)}`
										: "Aucun rapport envoyé pour l’instant"
								}
							>
								<div className="flex h-9 items-center gap-2">
									<Switch
										id="profile-enabled"
										checked={selected.enabled}
										onCheckedChange={(enabled) => patch({ enabled })}
									/>
									<Label htmlFor="profile-enabled" className="font-normal">
										{selected.enabled ? "Envoi programmé" : "En pause"}
									</Label>
								</div>
							</Field>
							<Field
								label="Destinataires"
								htmlFor="profile-emails"
								hint="Entrée, virgule ou espace pour ajouter une adresse."
								className="sm:col-span-2"
							>
								<TagInput
									id="profile-emails"
									value={selected.emails}
									onChange={(emails) =>
										patch({ emails, email: emails[0] ?? "" })
									}
									validate={(email) => EMAIL.test(email)}
									separators={/[,;\s]+/}
									placeholder="prenom@exemple.fr"
									aria-invalid={
										!selected.emails.length ||
										selected.emails.some((email) => !EMAIL.test(email))
									}
								/>
							</Field>
							<div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
								<Field label="Fréquence">
									<Select
										value={selected.frequency}
										onValueChange={(frequency) => patch({ frequency })}
									>
										<SelectTrigger className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="daily">Chaque jour</SelectItem>
											<SelectItem value="weekly">Chaque semaine</SelectItem>
										</SelectContent>
									</Select>
								</Field>
								{selected.frequency === "weekly" && (
									<Field label="Jour">
										<Select
											value={String(selected.weekday)}
											onValueChange={(day) => patch({ weekday: Number(day) })}
										>
											<SelectTrigger className="w-full capitalize">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{[1, 2, 3, 4, 5, 6, 0].map((day) => (
													<SelectItem
														key={day}
														value={String(day)}
														className="capitalize"
													>
														{weekdayNames[day]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</Field>
								)}
								<Field label="Heure">
									<Select
										value={String(selected.hour)}
										onValueChange={(hour) => patch({ hour: Number(hour) })}
									>
										<SelectTrigger className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{HOURS.map((hour) => (
												<SelectItem key={hour} value={String(hour)}>
													{String(hour).padStart(2, "0")}:00
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Candidature</CardTitle>
							<CardDescription>
								Une personne = une adresse email = un CV. Le CV sert de base aux
								candidatures adaptées ; il est partagé par tous les profils de
								cette personne.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-5">
							{selected.emails.length > 1 && (
								<Field
									label="Personne qui postule"
									hint="Les rapports partent à tous les destinataires ; les candidatures se font au nom de cette personne."
								>
									<Select
										value={owner}
										onValueChange={(ownerEmail) => patch({ ownerEmail })}
									>
										<SelectTrigger className="w-full sm:w-80">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{selected.emails.map((email) => (
												<SelectItem key={email} value={email}>
													{email}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							)}
							<CvPanel email={owner} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Ce que cette personne recherche</CardTitle>
							<CardDescription>
								Les offres hors critères disparaissent du radar et du rapport.
								Les mots-clés guident aussi la collecte des CDI.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-5">
							<Field label="Contrats">
								<ToggleGroup
									type="multiple"
									variant="outline"
									value={selected.contractTypes}
									onValueChange={(contractTypes) => patch({ contractTypes })}
									className="flex-wrap"
								>
									{CONTRACTS.map((contract) => (
										<ToggleGroupItem
											key={contract}
											value={contract}
											className="px-4 data-[state=on]:bg-foreground data-[state=on]:text-background"
										>
											{contract}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</Field>
							<Field
								label="Mots-clés prioritaires"
								htmlFor="profile-keywords"
								hint="Cherchés en mot entier dans le titre, le service et les compétences. Ils définissent l’adéquation."
							>
								<TagInput
									id="profile-keywords"
									value={selected.targetKeywords}
									onChange={(targetKeywords) => patch({ targetKeywords })}
									placeholder="onboarding, KYC, data…"
								/>
							</Field>
							<Field
								label="Mots à exclure"
								htmlFor="profile-excluded"
								hint="Une offre dont le titre contient l’un de ces mots est écartée."
							>
								<TagInput
									id="profile-excluded"
									value={selected.excludedKeywords}
									onChange={(excludedKeywords) => patch({ excludedKeywords })}
									placeholder="senior, développeur…"
								/>
							</Field>
							<Field
								label="Cible marchés"
								hint="« Support front » favorise les métiers accessibles autour de la salle des marchés (onboarding, KYC, documentation ISDA/CSA, limites de crédit, collatéral, transaction management…) et déprioritise les postes très sélectifs (trader, sales, structureur, quant)."
							>
								<ToggleGroup
									type="single"
									variant="outline"
									value={selected.marketFocus}
									onValueChange={(marketFocus) =>
										marketFocus && patch({ marketFocus })
									}
									className="flex-wrap"
								>
									<ToggleGroupItem value="all" className="px-4">
										Tous les postes
									</ToggleGroupItem>
									<ToggleGroupItem value="support" className="px-4">
										Support front (accessible)
									</ToggleGroupItem>
								</ToggleGroup>
							</Field>
							<Field
								label="Postes techniques"
								hint="Développement, DevOps, data engineering, ingénierie… (jugé sur le titre). Utile pour un profil métier comme le Front Office."
							>
								<ToggleGroup
									type="single"
									variant="outline"
									value={selected.techRoles}
									onValueChange={(techRoles) =>
										techRoles && patch({ techRoles })
									}
									className="flex-wrap"
								>
									<ToggleGroupItem value="include" className="px-4">
										Inclure
									</ToggleGroupItem>
									<ToggleGroupItem value="downrank" className="px-4">
										Déprioriser
									</ToggleGroupItem>
									<ToggleGroupItem value="exclude" className="px-4">
										Exclure
									</ToggleGroupItem>
								</ToggleGroup>
							</Field>
							<Field
								label="Expérience exigée au maximum"
								hint="Une annonce sans exigence claire reste visible. Jusqu’à 3 ans, les titres seniors (Head of, Director, VP, Senior…) sont déprioritisés."
							>
								<Select
									value={String(selected.maxExperienceYears)}
									onValueChange={(years) =>
										patch({ maxExperienceYears: Number(years) })
									}
								>
									<SelectTrigger className="w-full sm:w-56">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[0, 1, 2, 3, 4, 5, 7, 10, 15, 30].map((years) => (
											<SelectItem key={years} value={String(years)}>
												{years === 30
													? "Aucune limite"
													: years === 0
														? "Débutant uniquement"
														: `${years} an${years > 1 ? "s" : ""}`}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Entreprises</CardTitle>
							<CardDescription>
								Les filiales sont incluses (LVMH couvre Dior, Sephora…).
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4">
							<ToggleGroup
								type="single"
								variant="outline"
								value={selected.companyFilterMode}
								onValueChange={(mode) =>
									mode && patch({ companyFilterMode: mode })
								}
								className="flex-wrap"
							>
								<ToggleGroupItem value="all" className="px-4">
									Toutes
								</ToggleGroupItem>
								<ToggleGroupItem value="block" className="px-4">
									Toutes sauf…
								</ToggleGroupItem>
								<ToggleGroupItem value="allow" className="px-4">
									Uniquement…
								</ToggleGroupItem>
							</ToggleGroup>
							{selected.companyFilterMode !== "all" && (
								<CompanyPicker
									options={(overview?.sources ?? []).map((source) => ({
										name: source.name,
										sector: source.sector,
									}))}
									value={selected.companies}
									onChange={(companies) => patch({ companies })}
								/>
							)}
						</CardContent>
					</Card>

					<WeightsCard
						profile={selected}
						onChange={(weights) => patch({ weights })}
					/>

					<LivePreview profile={selected} />

					<SourcesCard sources={overview?.sources} />
				</div>
			</div>

			<div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-md">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
					<span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
						{dirty ? (
							<>
								<span className="size-1.5 rounded-full bg-warning" />
								Modifications non enregistrées
							</>
						) : (
							<>
								<CheckCircle2 className="size-4 text-success" /> À jour
							</>
						)}
						{issues.length > 0 && (
							<span className="text-destructive">· {issues[0]}</span>
						)}
					</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setConfirmDelete(true)}
						disabled={profiles.length < 2}
						className="text-muted-foreground"
					>
						<Trash2 /> Supprimer
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPreview(true)}
						disabled={dirty}
						title={dirty ? "Enregistre d’abord tes modifications" : undefined}
					>
						<Eye /> Aperçu du rapport
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setConfirmSend(true)}
						disabled={runActive || issues.length > 0}
					>
						{runActive ? <LoaderCircle className="animate-spin" /> : <Send />}
						{runActive ? "Routine en cours" : "Envoyer maintenant"}
					</Button>
					{dirty && (
						<Button variant="ghost" size="sm" onClick={discard}>
							Annuler
						</Button>
					)}
					<Button size="sm" onClick={save} disabled={!dirty || saving}>
						{saving && <LoaderCircle className="animate-spin" />}
						Enregistrer
					</Button>
				</div>
			</div>

			<AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Envoyer le rapport maintenant ?</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-2">
								<p>
									Le worker va lancer une collecte complète (quelques minutes),
									puis envoyer un vrai email « {selected.name} » à :
								</p>
								<ul className="list-inside list-disc text-foreground">
									{selected.emails.map((email) => (
										<li key={email}>{email}</li>
									))}
								</ul>
								<p>C’est un rapport de veille, pas une candidature.</p>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Annuler</AlertDialogCancel>
						<AlertDialogAction onClick={sendNow}>
							<Send /> Envoyer
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Supprimer « {selected.name} » ?</AlertDialogTitle>
						<AlertDialogDescription>
							Son rapport ne sera plus envoyé. La suppression devient définitive
							quand tu enregistres.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Annuler</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-white hover:bg-destructive/90"
							onClick={() => {
								const next = profiles.filter(
									(profile) => profile.id !== selected.id,
								);
								setProfiles(next);
								setDirty(true);
								if (next[0]) onSelect(next[0].id);
							}}
						>
							Supprimer
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<ReportPreview
				open={preview}
				onOpenChange={setPreview}
				profileId={selected.id}
			/>
		</div>
	);
}

function Field({
	label,
	htmlFor,
	hint,
	className,
	children,
}: {
	label: string;
	htmlFor?: string;
	hint?: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

function WeightsCard({
	profile,
	onChange,
}: {
	profile: Profile;
	onChange: (weights: Profile["weights"]) => void;
}) {
	const { weights } = profile;
	const sum = Math.max(1, weights.tech + weights.market + weights.fit);
	const rows = [
		["tech", "Tech", "IT, data, IA, SI, développement, projet"],
		["market", "Marchés", "Global Markets, Front Office, KYC, opérations"],
		[
			"fit",
			"Adéquation",
			"Mots-clés du profil trouvés, ou pertinence générale de l’offre",
		],
	] as const;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Scoring</CardTitle>
				<CardDescription>
					Score = moyenne pondérée des trois axes (sur 100), plus 2 points par
					mot-clé trouvé (8 au maximum). P1 à partir de 75, P2 à partir de 58.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-6">
				{rows.map(([key, label, hint]) => (
					<div key={key} className="grid gap-3">
						<div className="flex items-baseline justify-between gap-4">
							<div>
								<p className="text-sm font-medium">{label}</p>
								<p className="text-xs text-muted-foreground">{hint}</p>
							</div>
							<span className="tabular text-sm text-muted-foreground">
								{Math.round((weights[key] / sum) * 100)} %
							</span>
						</div>
						<Slider
							value={[weights[key]]}
							min={0}
							max={100}
							step={5}
							onValueChange={([value]) =>
								onChange({ ...weights, [key]: value ?? 0 })
							}
							aria-label={`Poids ${label}`}
						/>
					</div>
				))}
			</CardContent>
		</Card>
	);
}

function LivePreview({ profile }: { profile: Profile }) {
	const draft = useDebounced(
		{
			contractTypes: profile.contractTypes,
			targetKeywords: profile.targetKeywords,
			excludedKeywords: profile.excludedKeywords,
			techRoles: profile.techRoles,
			marketFocus: profile.marketFocus,
			maxExperienceYears: profile.maxExperienceYears,
			companyFilterMode: profile.companyFilterMode,
			companies: profile.companies,
			weights: profile.weights,
		},
		400,
	);
	const result = useQuery(api.jobs.profilePreview, { draft });
	return (
		<Card>
			<CardHeader>
				<CardTitle>Aperçu en direct</CardTitle>
				<CardDescription>
					Ce que ces critères donnent sur les offres actuellement suivies, avant
					même d’enregistrer.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="grid grid-cols-3 gap-3">
					{(
						[
							["Éligibles", result?.eligible],
							["Pertinentes", result?.relevant],
							["P1", result?.p1],
						] as const
					).map(([label, value]) => (
						<div key={label} className="rounded-lg border px-3 py-2.5">
							<p className="text-xs text-muted-foreground">{label}</p>
							{value === undefined ? (
								<Skeleton className="mt-1 h-6 w-12" />
							) : (
								<p className="tabular text-xl font-semibold">{value}</p>
							)}
						</div>
					))}
				</div>
				<ul className="divide-y rounded-lg border">
					{result?.top.map((job) => (
						<li key={job._id} className="flex items-center gap-3 px-3 py-2.5">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{job.title}</p>
								<p className="truncate text-xs text-muted-foreground">
									{job.company}
									{job.matches.length > 0 && ` · ${job.matches.join(", ")}`}
								</p>
							</div>
							<span className="tabular text-sm font-medium">{job.score}</span>
							<PriorityBadge priority={job.priority} />
						</li>
					))}
					{result && result.top.length === 0 && (
						<li className="px-3 py-6 text-center text-sm text-muted-foreground">
							Aucune offre pertinente avec ces critères. Ajoute des mots-clés ou
							élargis les contrats.
						</li>
					)}
				</ul>
			</CardContent>
		</Card>
	);
}

function ReportPreview({
	open,
	onOpenChange,
	profileId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	profileId: string;
}) {
	const data = useQuery(api.jobs.reportData, open ? { profileId } : "skip");
	const report = useMemo(
		() =>
			data
				? buildReport(
						data as ReportData,
						typeof window === "undefined" ? "" : window.location.origin,
					)
				: null,
		[data],
	);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[92dvh] gap-4 sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Aperçu du rapport</DialogTitle>
					<DialogDescription>
						{report ? (
							<>
								Objet :{" "}
								<span className="text-foreground">{report.subject}</span>
								<br />À : {data?.profile.emails.join(", ")} · rien n’est envoyé
								depuis cet aperçu.
							</>
						) : (
							"Préparation…"
						)}
					</DialogDescription>
				</DialogHeader>
				{report ? (
					<iframe
						title="Aperçu du rapport email"
						srcDoc={report.html.replace(
							"<head>",
							'<head><base target="_blank">',
						)}
						// No scripts in the email: same-origin only lets it render.
						sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
						className="h-[65dvh] w-full shrink-0 rounded-lg border bg-white"
					/>
				) : (
					<Skeleton className="h-[60dvh]" />
				)}
			</DialogContent>
		</Dialog>
	);
}

type Source = {
	key: string;
	name: string;
	sector: string;
	url: string;
	status: string;
	jobs: number;
	relevant: number;
	lastRunAt?: number;
	error?: string;
};

function SourcesCard({ sources }: { sources?: Source[] }) {
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const pageSize = 8;
	const filtered = (sources ?? []).filter((source) =>
		`${source.name} ${source.sector}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	);
	const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
	const current = Math.min(page, pages - 1);
	return (
		<Card className="gap-0 overflow-hidden pb-0">
			<CardHeader className="border-b pb-4">
				<CardTitle>Sources</CardTitle>
				<CardDescription>
					{sources?.length ?? "…"} sites carrières collectés pour tous les
					profils.
				</CardDescription>
				<div className="col-span-full mt-2">
					<InputGroup className="sm:max-w-xs">
						<InputGroupAddon>
							<Search />
						</InputGroupAddon>
						<InputGroupInput
							placeholder="Rechercher une source"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setPage(0);
							}}
						/>
					</InputGroup>
				</div>
			</CardHeader>
			<ul className="divide-y">
				{filtered
					.slice(current * pageSize, current * pageSize + pageSize)
					.map((source) => (
						<li key={source.key} className="flex items-center gap-3 px-6 py-3">
							<SourceStatus status={source.status} />
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{source.name}</p>
								<p className="truncate text-xs text-muted-foreground">
									{source.status === "error" || source.status === "blocked"
										? source.error
										: `${source.sector} · ${source.jobs} offres · collecte ${timeAgo(source.lastRunAt)}`}
								</p>
							</div>
							<Button asChild variant="ghost" size="icon-sm">
								<a
									href={source.url}
									target="_blank"
									rel="noreferrer"
									aria-label={`Ouvrir ${source.name}`}
								>
									<ExternalLink />
								</a>
							</Button>
						</li>
					))}
			</ul>
			<div className="flex items-center justify-between border-t px-6 py-3 text-sm text-muted-foreground">
				<span className="tabular">
					Page {current + 1} / {pages}
				</span>
				<div className="flex gap-1">
					<Button
						variant="outline"
						size="icon-sm"
						disabled={current === 0}
						onClick={() => setPage(current - 1)}
						aria-label="Page précédente"
					>
						<ChevronLeft />
					</Button>
					<Button
						variant="outline"
						size="icon-sm"
						disabled={current >= pages - 1}
						onClick={() => setPage(current + 1)}
						aria-label="Page suivante"
					>
						<ChevronRight />
					</Button>
				</div>
			</div>
		</Card>
	);
}

export function SourceStatus({ status }: { status: string }) {
	if (status === "connected")
		return (
			<CheckCircle2
				className="size-4 shrink-0 text-success"
				aria-label="Connectée"
			/>
		);
	if (status === "running")
		return (
			<LoaderCircle
				className="size-4 shrink-0 animate-spin text-info"
				aria-label="En cours"
			/>
		);
	if (status === "pending")
		return (
			<CircleDashed
				className="size-4 shrink-0 text-muted-foreground"
				aria-label="En attente"
			/>
		);
	return (
		<Badge
			variant="outline"
			className={cn(
				"h-5 shrink-0 px-1.5 text-[10px]",
				status === "blocked"
					? "text-muted-foreground"
					: "border-destructive/40 text-destructive",
			)}
		>
			{status === "blocked" ? "Bloquée" : "Erreur"}
		</Badge>
	);
}
