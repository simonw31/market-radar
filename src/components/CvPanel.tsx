import { useMutation, useQuery } from "convex/react";
import {
	AlertTriangle,
	CheckCircle2,
	FileText,
	LoaderCircle,
	Pencil,
	Plus,
	RotateCcw,
	Trash2,
	Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { type Cv, emptyCv } from "../../convex/lib/cv";
import { TagInput } from "./inputs";
import { LetterLibraryButton } from "./LetterLibrary";
import { timeAgo } from "./shared";

/** CV attached to one person (email): upload, AI extraction, review. */
export function CvPanel({ email }: { email: string }) {
	const candidate = useQuery(api.candidates.get, email ? { email } : "skip");
	const generateUploadUrl = useMutation(api.candidates.generateUploadUrl);
	const attachFile = useMutation(api.candidates.attachFile);
	const retry = useMutation(api.candidates.retryExtraction);
	const [uploading, setUploading] = useState(false);
	const [editing, setEditing] = useState(false);
	const [dragging, setDragging] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const initial = useMemo(
		() => candidate?.cv ?? emptyCv(email),
		[candidate?.cv, email],
	);

	async function upload(file: File) {
		if (file.type !== "application/pdf") {
			toast.error("Le CV doit être un fichier PDF");
			return;
		}
		setUploading(true);
		try {
			const url = await generateUploadUrl();
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!response.ok)
				throw new Error(`Envoi du fichier : HTTP ${response.status}`);
			const { storageId } = (await response.json()) as {
				storageId: Id<"_storage">;
			};
			await attachFile({ email, storageId, name: file.name, size: file.size });
			toast.success("CV importé", {
				description:
					"L’IA locale le structure (1 à 3 minutes). Tu pourras le relire ensuite.",
			});
		} catch (error) {
			toast.error("Import impossible", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setUploading(false);
		}
	}

	if (!email) {
		return (
			<p className="text-sm text-muted-foreground">
				Ajoute d’abord une adresse email au profil.
			</p>
		);
	}
	if (candidate === undefined) return <Skeleton className="h-28" />;

	const status = candidate?.status ?? "empty";
	const cv = candidate?.cv;
	const busy = uploading || status === "queued" || status === "extracting";

	return (
		<div className="grid gap-4">
			<input
				ref={input}
				type="file"
				accept="application/pdf"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void upload(file);
					event.target.value = "";
				}}
			/>

			{busy ? (
				<div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
					<LoaderCircle className="size-4 animate-spin" />
					<div>
						<p className="font-medium">
							{uploading ? "Envoi du PDF…" : "Analyse du CV par l’IA locale…"}
						</p>
						<p className="text-muted-foreground">
							Extraction du texte puis structuration (1 à 3 minutes). Tu pourras
							tout relire.
						</p>
					</div>
				</div>
			) : cv ? (
				<div className="rounded-lg border p-4">
					<div className="flex flex-wrap items-start gap-3">
						<span className="grid size-9 place-items-center rounded-md bg-muted">
							<FileText className="size-4" />
						</span>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-2">
								<p className="font-medium">{cv.fullName}</p>
								{status === "review" ? (
									<Badge className="border-transparent bg-warning-soft text-warning">
										À vérifier
									</Badge>
								) : (
									<Badge className="border-transparent bg-success-soft text-success">
										<CheckCircle2 /> Validé
									</Badge>
								)}
							</div>
							<p className="truncate text-sm text-muted-foreground">
								{cv.headline ?? email}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{cv.experience.length} expérience
								{cv.experience.length > 1 ? "s" : ""} · {cv.education.length}{" "}
								formation{cv.education.length > 1 ? "s" : ""} ·{" "}
								{cv.skills.reduce((sum, group) => sum + group.items.length, 0)}{" "}
								compétences
								{candidate?.reviewedAt &&
									` · validé ${timeAgo(candidate.reviewedAt)}`}
							</p>
						</div>
					</div>
					{status === "review" && (
						<p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
							Extrait automatiquement : relis-le avant qu’il serve aux
							candidatures.
						</p>
					)}
					{status === "error" && candidate?.error && (
						<p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
							Dernier import en échec : {candidate.error}
						</p>
					)}
				</div>
			) : status === "error" ? (
				<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
					<p className="flex items-center gap-2 font-medium text-destructive">
						<AlertTriangle className="size-4" /> L’analyse automatique a échoué
					</p>
					<p className="mt-1 text-muted-foreground">{candidate?.error}</p>
				</div>
			) : (
				<button
					type="button"
					onClick={() => input.current?.click()}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						setDragging(false);
						const file = event.dataTransfer.files[0];
						if (file) void upload(file);
					}}
					className={cn(
						"flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm transition-colors hover:bg-muted/50",
						dragging && "border-foreground bg-muted/50",
					)}
				>
					<Upload className="size-5 text-muted-foreground" />
					<span className="font-medium">Dépose le CV ici (PDF)</span>
					<span className="text-muted-foreground">
						ou clique pour choisir un fichier. Il sera rattaché à {email}.
					</span>
				</button>
			)}

			<div className="flex flex-wrap gap-2">
				{cv && (
					<Button
						size="sm"
						variant={status === "review" ? "default" : "outline"}
						onClick={() => setEditing(true)}
						disabled={busy}
					>
						<Pencil />
						{status === "review" ? "Vérifier et valider" : "Modifier le CV"}
					</Button>
				)}
				{cv && <LetterLibraryButton email={email} />}
				{(cv || status !== "empty") && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => input.current?.click()}
						disabled={busy}
					>
						<Upload />{" "}
						{candidate?.file ? "Remplacer le PDF" : "Importer un PDF"}
					</Button>
				)}
				{!cv && !busy && (
					<Button size="sm" variant="outline" onClick={() => setEditing(true)}>
						<Pencil /> Saisir à la main
					</Button>
				)}
				{status === "error" && candidate?.file && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => void retry({ email })}
					>
						<RotateCcw /> Relancer l’analyse
					</Button>
				)}
				{candidate?.fileUrl && (
					<Button asChild size="sm" variant="ghost">
						<a href={candidate.fileUrl} target="_blank" rel="noreferrer">
							<FileText /> {candidate.file?.name ?? "PDF d’origine"}
						</a>
					</Button>
				)}
			</div>

			<CvEditor
				open={editing}
				onOpenChange={setEditing}
				email={email}
				initial={initial}
				review={status === "review"}
			/>
		</div>
	);
}

// Plain counter: crypto.randomUUID() is unavailable over plain HTTP (LAN).
let rowSequence = 0;
const nextRowId = () => `row-${++rowSequence}`;

type ListKey = "education" | "experience" | "projects" | "skills" | "languages";

type EditorProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	email: string;
	initial: Cv;
	review: boolean;
};

function CvEditor(props: EditorProps) {
	return (
		<Sheet open={props.open} onOpenChange={props.onOpenChange}>
			<SheetContent className="w-full gap-0 sm:max-w-3xl">
				{/* Mounted on open only: the form always starts from the saved CV. */}
				{props.open && <CvEditorBody {...props} />}
			</SheetContent>
		</Sheet>
	);
}

function CvEditorBody({ onOpenChange, email, initial, review }: EditorProps) {
	const saveCv = useMutation(api.candidates.saveCv);
	const [cv, setCv] = useState<Cv>(initial);
	const [saving, setSaving] = useState(false);
	// Stable React keys for editable lists (indexes shift on removal).
	const [ids, setIds] = useState(() => {
		const make = (count: number) =>
			Array.from({ length: count }, () => nextRowId());
		return {
			education: make(initial.education.length),
			experience: make(initial.experience.length),
			projects: make(initial.projects.length),
			skills: make(initial.skills.length),
			languages: make(initial.languages.length),
		};
	});

	// LinkedIn and GitHub/site are stored as labelled links.
	const isLinkedIn = (url: string) => /linkedin\.com/i.test(url);
	function linkFor(label: "LinkedIn" | "GitHub") {
		return (
			cv.links?.find((link) =>
				label === "LinkedIn" ? isLinkedIn(link.url) : !isLinkedIn(link.url),
			)?.url ?? ""
		);
	}
	function setLink(label: "LinkedIn" | "GitHub", url: string) {
		const others = (cv.links ?? []).filter((link) =>
			label === "LinkedIn" ? !isLinkedIn(link.url) : isLinkedIn(link.url),
		);
		const value = url.trim();
		set("links", value ? [...others, { label, url: value }] : others);
	}
	function set<K extends keyof Cv>(key: K, value: Cv[K]) {
		setCv((current) => ({ ...current, [key]: value }));
	}
	function update<
		K extends "education" | "experience" | "projects" | "skills" | "languages",
	>(key: K, index: number, patch: Partial<Cv[K][number]>) {
		setCv((current) => ({
			...current,
			[key]: current[key].map((item, position) =>
				position === index ? { ...item, ...patch } : item,
			),
		}));
	}
	function addItem<K extends ListKey>(key: K, item: Cv[K][number]) {
		setCv((current) => ({ ...current, [key]: [...current[key], item] }));
		setIds((current) => ({
			...current,
			[key]: [...current[key], nextRowId()],
		}));
	}
	function remove(
		key: "education" | "experience" | "projects" | "skills" | "languages",
		index: number,
	) {
		setCv((current) => ({
			...current,
			[key]: current[key].filter((_, position) => position !== index),
		}));
		setIds((current) => ({
			...current,
			[key]: current[key].filter((_, position) => position !== index),
		}));
	}

	async function save() {
		setSaving(true);
		try {
			await saveCv({ email, cv });
			toast.success("CV enregistré", {
				description: "Il servira de base aux candidatures adaptées.",
			});
			onOpenChange(false);
		} catch (error) {
			toast.error("Enregistrement impossible", {
				description:
					error instanceof Error
						? error.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]
						: undefined,
			});
		} finally {
			setSaving(false);
		}
	}

	const lines = (value: string) =>
		value
			.split("\n")
			.map((line) => line.replace(/^[\s▪•\-–]+/, "").trim())
			.filter(Boolean);

	return (
		<>
			<SheetHeader className="border-b pr-12">
				<SheetTitle>CV de référence · {email}</SheetTitle>
				<SheetDescription>
					{review
						? "Extrait automatiquement : vérifie chaque section puis valide."
						: "Source unique des candidatures : l’IA pourra réordonner et reformuler, jamais ajouter."}
				</SheetDescription>
			</SheetHeader>
			<ScrollArea className="min-h-0 flex-1">
				<div className="grid gap-8 p-4">
					<Section title="Identité">
						<div className="grid gap-3 sm:grid-cols-2">
							<Text
								label="Nom complet"
								value={cv.fullName}
								onChange={(value) => set("fullName", value)}
							/>
							<Text
								label="Titre / accroche"
								value={cv.headline ?? ""}
								onChange={(value) => set("headline", value || undefined)}
							/>
							<Text
								label="Email"
								value={cv.email ?? ""}
								onChange={(value) => set("email", value || undefined)}
							/>
							<Text
								label="Téléphone"
								value={cv.phone ?? ""}
								onChange={(value) => set("phone", value || undefined)}
							/>
							<Text
								label="Adresse / ville"
								value={cv.location ?? ""}
								onChange={(value) => set("location", value || undefined)}
								className="sm:col-span-2"
							/>
							<Text
								label="Profil LinkedIn"
								value={linkFor("LinkedIn")}
								onChange={(value) => setLink("LinkedIn", value)}
							/>
							<Text
								label="GitHub ou site perso"
								value={linkFor("GitHub")}
								onChange={(value) => setLink("GitHub", value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Résumé (facultatif)</Label>
							<Textarea
								rows={3}
								value={cv.summary ?? ""}
								onChange={(event) =>
									set("summary", event.target.value || undefined)
								}
							/>
						</div>
					</Section>

					<Section
						title="Expériences"
						onAdd={() =>
							addItem("experience", { company: "", role: "", bullets: [] })
						}
					>
						{cv.experience.map((item, index) => (
							<Item
								key={ids.experience[index]}
								onRemove={() => remove("experience", index)}
							>
								<div className="grid gap-3 sm:grid-cols-2">
									<Text
										label="Entreprise"
										value={item.company}
										onChange={(company) =>
											update("experience", index, { company })
										}
									/>
									<Text
										label="Poste"
										value={item.role}
										onChange={(role) => update("experience", index, { role })}
									/>
									<Text
										label="Lieu"
										value={item.location ?? ""}
										onChange={(location) =>
											update("experience", index, {
												location: location || undefined,
											})
										}
									/>
									<div className="grid grid-cols-2 gap-3">
										<Text
											label="Début"
											value={item.start ?? ""}
											onChange={(start) =>
												update("experience", index, {
													start: start || undefined,
												})
											}
										/>
										<Text
											label="Fin"
											value={item.end ?? ""}
											onChange={(end) =>
												update("experience", index, { end: end || undefined })
											}
										/>
									</div>
								</div>
								<Lines
									label="Réalisations (une par ligne)"
									value={item.bullets}
									onChange={(value) =>
										update("experience", index, { bullets: lines(value) })
									}
								/>
							</Item>
						))}
					</Section>

					<Section
						title="Formation"
						onAdd={() =>
							addItem("education", { school: "", degree: "", details: [] })
						}
					>
						{cv.education.map((item, index) => (
							<Item
								key={ids.education[index]}
								onRemove={() => remove("education", index)}
							>
								<div className="grid gap-3 sm:grid-cols-2">
									<Text
										label="Établissement"
										value={item.school}
										onChange={(school) =>
											update("education", index, { school })
										}
									/>
									<Text
										label="Diplôme"
										value={item.degree}
										onChange={(degree) =>
											update("education", index, { degree })
										}
									/>
									<Text
										label="Lieu"
										value={item.location ?? ""}
										onChange={(location) =>
											update("education", index, {
												location: location || undefined,
											})
										}
									/>
									<div className="grid grid-cols-2 gap-3">
										<Text
											label="Début"
											value={item.start ?? ""}
											onChange={(start) =>
												update("education", index, {
													start: start || undefined,
												})
											}
										/>
										<Text
											label="Fin"
											value={item.end ?? ""}
											onChange={(end) =>
												update("education", index, { end: end || undefined })
											}
										/>
									</div>
								</div>
								<Lines
									label="Détails (une ligne par point)"
									value={item.details}
									onChange={(value) =>
										update("education", index, { details: lines(value) })
									}
								/>
							</Item>
						))}
					</Section>

					<Section
						title="Projets"
						onAdd={() =>
							addItem("projects", { name: "", description: "", stack: [] })
						}
					>
						{cv.projects.map((item, index) => (
							<Item
								key={ids.projects[index]}
								onRemove={() => remove("projects", index)}
							>
								<div className="grid gap-3 sm:grid-cols-[1fr_120px]">
									<Text
										label="Nom"
										value={item.name}
										onChange={(name) => update("projects", index, { name })}
									/>
									<Text
										label="Année"
										value={item.year ?? ""}
										onChange={(year) =>
											update("projects", index, { year: year || undefined })
										}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Description</Label>
									<Textarea
										rows={2}
										value={item.description}
										onChange={(event) =>
											update("projects", index, {
												description: event.target.value,
											})
										}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Technologies</Label>
									<TagInput
										value={item.stack}
										onChange={(stack) => update("projects", index, { stack })}
									/>
								</div>
							</Item>
						))}
					</Section>

					<Section
						title="Compétences"
						onAdd={() => addItem("skills", { category: "", items: [] })}
					>
						{cv.skills.map((item, index) => (
							<Item
								key={ids.skills[index]}
								onRemove={() => remove("skills", index)}
							>
								<Text
									label="Catégorie"
									value={item.category}
									onChange={(category) => update("skills", index, { category })}
								/>
								<TagInput
									value={item.items}
									onChange={(items) => update("skills", index, { items })}
								/>
							</Item>
						))}
					</Section>

					<Section
						title="Langues"
						onAdd={() => addItem("languages", { name: "", level: "" })}
					>
						{cv.languages.map((item, index) => (
							<Item
								key={ids.languages[index]}
								onRemove={() => remove("languages", index)}
							>
								<div className="grid grid-cols-2 gap-3">
									<Text
										label="Langue"
										value={item.name}
										onChange={(name) => update("languages", index, { name })}
									/>
									<Text
										label="Niveau"
										value={item.level}
										onChange={(level) => update("languages", index, { level })}
									/>
								</div>
							</Item>
						))}
					</Section>

					<Section title="Certifications et centres d’intérêt">
						<div className="grid gap-2">
							<Label>Certifications</Label>
							<TagInput
								value={cv.certifications}
								onChange={(value) => set("certifications", value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Centres d’intérêt</Label>
							<TagInput
								value={cv.interests}
								onChange={(value) => set("interests", value)}
							/>
						</div>
					</Section>
				</div>
			</ScrollArea>
			<SheetFooter className="flex-row justify-end gap-2 border-t">
				<Button variant="ghost" onClick={() => onOpenChange(false)}>
					Annuler
				</Button>
				<Button onClick={save} disabled={saving || !cv.fullName.trim()}>
					{saving && <LoaderCircle className="animate-spin" />}
					{review ? "Valider ce CV" : "Enregistrer"}
				</Button>
			</SheetFooter>
		</>
	);
}

function Section({
	title,
	onAdd,
	children,
}: {
	title: string;
	onAdd?: () => void;
	children: React.ReactNode;
}) {
	return (
		<section className="grid gap-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold">{title}</h3>
				{onAdd && (
					<Button size="xs" variant="ghost" onClick={onAdd}>
						<Plus /> Ajouter
					</Button>
				)}
			</div>
			<Separator />
			{children}
		</section>
	);
}

function Item({
	onRemove,
	children,
}: {
	onRemove: () => void;
	children: React.ReactNode;
}) {
	return (
		<div className="relative grid gap-3 rounded-lg border p-3 pr-10">
			<Button
				size="icon-xs"
				variant="ghost"
				className="absolute top-2 right-2 text-muted-foreground"
				onClick={onRemove}
				aria-label="Supprimer"
			>
				<Trash2 />
			</Button>
			{children}
		</div>
	);
}

function Text({
	label,
	value,
	onChange,
	className,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	className?: string;
}) {
	return (
		<div className={cn("grid gap-1.5", className)}>
			<Label className="text-xs text-muted-foreground">{label}</Label>
			<Input value={value} onChange={(event) => onChange(event.target.value)} />
		</div>
	);
}

/** Multi-line editor that keeps the raw text while typing. */
function Lines({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string[];
	onChange: (value: string) => void;
}) {
	const [text, setText] = useState(value.join("\n"));
	return (
		<div className="grid gap-1.5">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			<Textarea
				rows={Math.max(2, value.length + 1)}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onBlur={() => onChange(text)}
			/>
		</div>
	);
}
