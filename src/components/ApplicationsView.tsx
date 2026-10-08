import { useMutation, useQuery } from "convex/react";
import {
	Archive,
	ArrowUpRight,
	Check,
	CircleAlert,
	FileText,
	LoaderCircle,
	RefreshCw,
	Send,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { Card } from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
	attachmentName,
	buildEmailDraft,
	cvBullets,
	EMAIL_PATTERN,
	isBlockedRecipient,
	type Letter,
} from "../../convex/lib/application";
import { SectionHeader, timeAgo } from "./shared";

const statusLabels: Record<string, string> = {
	queued: "En file",
	generating: "Préparation…",
	rendering: "PDF en cours…",
	"rendering-busy": "PDF en cours…",
	ready: "À relire",
	validated: "Validée",
	sending: "Envoi en file…",
	"sending-busy": "Envoi…",
	sent: "Envoyée",
	error: "Erreur",
	archived: "Archivée",
};

function StatusBadge({ status }: { status: string }) {
	const busy = [
		"queued",
		"generating",
		"rendering",
		"rendering-busy",
		"sending",
		"sending-busy",
	].includes(status);
	return (
		<Badge
			variant="outline"
			className={cn(
				"h-5 gap-1 rounded-full px-2 text-[11px] font-medium",
				status === "ready" && "border-transparent bg-warning-soft text-warning",
				(status === "validated" || status === "sent") &&
					"border-transparent bg-success-soft text-success",
				status === "error" && "border-destructive/40 text-destructive",
				busy && "border-transparent bg-info-soft text-info",
			)}
		>
			{busy && <LoaderCircle className="size-3 animate-spin" />}
			{statusLabels[status] ?? status}
		</Badge>
	);
}

export function ApplicationsView({
	selectedId,
	onSelect,
}: {
	selectedId?: string;
	onSelect: (id: string) => void;
}) {
	const applications = useQuery(api.applications.list);
	const [showArchived, setShowArchived] = useState(false);
	const visible = (applications ?? []).filter(
		(item) => showArchived || item.status !== "archived",
	);
	const current = visible.find((item) => item._id === selectedId) ?? visible[0];

	return (
		<div>
			<SectionHeader
				title="Candidatures"
				description="Préparées en local à partir de ton CV et de ta bibliothèque de lettre. Rien n’est envoyé sans ta validation."
				actions={
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setShowArchived((value) => !value)}
					>
						<Archive />{" "}
						{showArchived ? "Masquer les archives" : "Voir les archives"}
					</Button>
				}
			/>
			{applications === undefined ? (
				<Skeleton className="h-96" />
			) : visible.length === 0 ? (
				<Card>
					<Empty className="py-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FileText />
							</EmptyMedia>
							<EmptyTitle>Aucune candidature en préparation</EmptyTitle>
							<EmptyDescription>
								Dans le Radar, ouvre une offre puis « Préparer la candidature ».
								Il faut un CV et une bibliothèque de lettre (Profils →
								Candidature).
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</Card>
			) : (
				<div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
					<Card className="gap-0 self-start py-2">
						{visible.map((item) => (
							<button
								type="button"
								key={item._id}
								onClick={() => onSelect(item._id)}
								className={cn(
									"mx-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted",
									item._id === current?._id && "bg-muted",
								)}
							>
								<p className="truncate text-xs text-muted-foreground">
									{item.company}
								</p>
								<p className="line-clamp-2 text-sm font-medium leading-snug">
									{item.jobTitle}
								</p>
								<div className="mt-1.5 flex items-center gap-2">
									<StatusBadge status={item.status} />
									<span className="text-xs text-muted-foreground">
										{timeAgo(item.updatedAt)}
									</span>
								</div>
							</button>
						))}
					</Card>
					{current && <ApplicationDetail key={current._id} id={current._id} />}
				</div>
			)}
		</div>
	);
}

function ApplicationDetail({ id }: { id: Id<"applications"> }) {
	const application = useQuery(api.applications.get, { id });
	const updateLetter = useMutation(api.applications.updateLetter);
	const regenerate = useMutation(api.applications.regenerate);
	const validate = useMutation(api.applications.validate);
	const archive = useMutation(api.applications.archive);
	const [letter, setLetter] = useState<Letter | null>(null);
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		if (application?.letter && !dirty) setLetter(application.letter);
	}, [application?.letter, dirty]);

	if (!application) return <Skeleton className="h-[600px]" />;
	const busy = ["queued", "generating", "rendering", "rendering-busy"].includes(
		application.status,
	);
	const bullets = application.cv ? cvBullets(application.cv) : [];
	const highlighted = bullets.filter((bullet) =>
		application.selection?.bullets.includes(bullet.id),
	);
	const chosenBlocks = application.blocks.filter((block) =>
		application.selection?.blocks.includes(block.id),
	);

	async function act(action: () => Promise<unknown>, success?: string) {
		try {
			await action();
			if (success) toast.success(success);
		} catch (error) {
			toast.error("Action impossible", {
				description:
					error instanceof Error
						? error.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]
						: undefined,
			});
		}
	}

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<Card className="gap-4 px-6">
				<div className="flex flex-wrap items-start gap-4">
					<div className="min-w-0 flex-1">
						<p className="text-sm text-muted-foreground">
							{application.company}
						</p>
						<h2 className="text-lg font-semibold leading-snug">
							{application.jobTitle}
						</h2>
						<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<StatusBadge status={application.status} />
							<span>pour {application.candidateEmail}</span>
							{application.durationMs && (
								<span>
									· préparée en {Math.round(application.durationMs / 1000)} s
								</span>
							)}
							{application.job && !application.job.active && (
								<Badge variant="outline" className="text-destructive">
									Offre retirée
								</Badge>
							)}
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						{application.job && (
							<Button asChild size="sm" variant="outline">
								<a href={application.job.url} target="_blank" rel="noreferrer">
									Offre <ArrowUpRight />
								</a>
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() =>
								act(() => regenerate({ id }), "Nouvelle préparation lancée")
							}
						>
							<RefreshCw /> Régénérer
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => act(() => archive({ id }), "Candidature archivée")}
						>
							<Archive /> Archiver
						</Button>
						{application.status === "validated" && application.job ? (
							<Button asChild size="sm">
								<a
									href={`${application.job.applyUrl}#mr-apply=${id}`}
									target="_blank"
									rel="noreferrer"
								>
									<ArrowUpRight /> Postuler sur le site
								</a>
							</Button>
						) : (
							<Button
								size="sm"
								disabled={application.status !== "ready" || dirty}
								onClick={() =>
									act(() => validate({ id }), "Candidature validée")
								}
							>
								<Check /> Valider
							</Button>
						)}
					</div>
				</div>
				{application.schedule && (
					<div
						className={cn(
							"grid gap-0.5 rounded-md px-3 py-2 text-xs",
							application.schedule.startSource === "annonce" &&
								application.schedule.durationSource === "annonce"
								? "bg-muted text-muted-foreground"
								: "bg-warning-soft text-warning",
						)}
					>
						<span>📅 {application.schedule.start}</span>
						<span>⏱ {application.schedule.duration}</span>
					</div>
				)}
				{application.status === "error" && (
					<p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{application.error}
					</p>
				)}
				{busy && (
					<p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
						<LoaderCircle className="size-4 animate-spin" />
						L’IA locale choisit les éléments, puis les PDF sont générés (environ
						1 à 2 minutes).
					</p>
				)}
				{application.status === "validated" && <ExtensionHint />}
			</Card>

			{application.selection && (
				<Card className="gap-4 px-6">
					<h3 className="flex items-center gap-2 text-sm font-semibold">
						<Sparkles className="size-4" /> Ce que l’IA locale a choisi
					</h3>
					<div className="grid gap-4 text-sm sm:grid-cols-2">
						<div>
							<p className="mb-1 text-xs text-muted-foreground">
								Missions repérées dans l’offre
							</p>
							<ul className="list-inside list-disc space-y-0.5">
								{application.selection.missions.map((mission) => (
									<li key={mission}>{mission}</li>
								))}
								{application.selection.missions.length === 0 && <li>—</li>}
							</ul>
						</div>
						<div>
							<p className="mb-1 text-xs text-muted-foreground">
								Paragraphes retenus
							</p>
							<ul className="list-inside list-disc space-y-0.5">
								{chosenBlocks.map((block) => (
									<li key={block.id}>{block.title || block.id}</li>
								))}
							</ul>
						</div>
						<div>
							<p className="mb-1 text-xs text-muted-foreground">
								Lignes du CV mises en avant
							</p>
							<ul className="list-inside list-disc space-y-0.5">
								{highlighted.map((bullet) => (
									<li key={bullet.id} className="line-clamp-1">
										{bullet.text}
									</li>
								))}
								{highlighted.length === 0 && <li>Ordre du CV conservé</li>}
							</ul>
						</div>
						<div>
							<p className="mb-1 text-xs text-muted-foreground">
								Compétences mises en avant
							</p>
							<div className="flex flex-wrap gap-1">
								{application.selection.skills.map((skill) => (
									<Badge
										key={skill}
										variant="secondary"
										className="font-normal"
									>
										{skill}
									</Badge>
								))}
							</div>
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						Accroche{" "}
						{application.hookSource === "llm"
							? "rédigée par l’IA (contrôlée)"
							: "issue du modèle de repli"}{" "}
						; tout le reste vient de ton CV et de ta bibliothèque.
					</p>
				</Card>
			)}

			{application.status === "sent" ? (
				<EmailSection application={application} />
			) : (
				["validated", "sending", "sending-busy"].includes(
					application.status,
				) && (
					<details
						className="group rounded-xl border bg-card px-6 py-4"
						open={["sending", "sending-busy"].includes(application.status)}
					>
						<summary className="cursor-pointer text-sm font-medium text-muted-foreground group-open:mb-4">
							Ou envoyer par email à un recruteur (si tu as son adresse)
						</summary>
						<EmailSection application={application} bare />
					</details>
				)
			)}

			<Tabs defaultValue="lettre">
				<TabsList>
					<TabsTrigger value="lettre">Lettre</TabsTrigger>
					<TabsTrigger value="apercu-lettre" disabled={!application.letterUrl}>
						PDF lettre
					</TabsTrigger>
					<TabsTrigger value="apercu-cv" disabled={!application.cvUrl}>
						PDF CV
					</TabsTrigger>
				</TabsList>
				<TabsContent value="lettre">
					<Card className="gap-4 px-6">
						{letter ? (
							<>
								<div className="grid gap-1.5">
									<Label className="text-xs text-muted-foreground">Objet</Label>
									<Input
										value={letter.subject}
										onChange={(event) => {
											setLetter({ ...letter, subject: event.target.value });
											setDirty(true);
										}}
									/>
								</div>
								{letter.paragraphs.map((paragraph, index) => (
									<Textarea
										// biome-ignore lint/suspicious/noArrayIndexKey: fixed letter structure
										key={index}
										rows={Math.max(3, Math.ceil(paragraph.length / 95))}
										value={paragraph}
										onChange={(event) => {
											setLetter({
												...letter,
												paragraphs: letter.paragraphs.map((item, position) =>
													position === index ? event.target.value : item,
												),
											});
											setDirty(true);
										}}
									/>
								))}
								<div className="flex flex-wrap items-center justify-end gap-2">
									{dirty && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												setDirty(false);
												setLetter(application.letter ?? null);
											}}
										>
											Annuler
										</Button>
									)}
									<Button
										size="sm"
										disabled={!dirty || busy}
										onClick={() =>
											act(async () => {
												await updateLetter({ id, letter });
												setDirty(false);
											}, "Lettre enregistrée, PDF en cours de mise à jour")
										}
									>
										Enregistrer et mettre à jour les PDF
									</Button>
								</div>
							</>
						) : (
							<Skeleton className="h-64" />
						)}
					</Card>
				</TabsContent>
				<TabsContent value="apercu-lettre">
					{application.letterUrl && (
						<PdfFrame
							url={application.letterUrl}
							title="Lettre de motivation"
						/>
					)}
				</TabsContent>
				<TabsContent value="apercu-cv">
					{application.cvUrl && (
						<PdfFrame url={application.cvUrl} title="CV adapté" />
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}

function PdfFrame({ url, title }: { url: string; title: string }) {
	return (
		<Card className="gap-3 p-3">
			<div className="flex justify-end">
				<Button asChild size="sm" variant="outline">
					<a href={url} target="_blank" rel="noreferrer">
						<FileText /> Ouvrir / télécharger
					</a>
				</Button>
			</div>
			<iframe
				title={title}
				src={url}
				className="h-[80dvh] w-full rounded-md border bg-white"
			/>
		</Card>
	);
}

type ApplicationData = NonNullable<
	ReturnType<typeof useQuery<typeof api.applications.get>>
>;

const sentFormat = new Intl.DateTimeFormat("fr-FR", {
	dateStyle: "long",
	timeStyle: "short",
});

function cleanError(error: unknown) {
	return error instanceof Error
		? error.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]
		: undefined;
}

/** Explicit, confirmed email sending of a validated application. */
function EmailSection({
	application,
	bare = false,
}: {
	application: ApplicationData;
	bare?: boolean;
}) {
	const requestSend = useMutation(api.applications.requestSend);
	const cancelSend = useMutation(api.applications.cancelSend);
	const draft = buildEmailDraft({
		jobTitle: application.jobTitle,
		contractType: application.job?.contractType ?? "",
		cv: {
			fullName: application.cv?.fullName ?? "",
			phone: application.cv?.phone,
			email: application.candidateEmail,
		},
		hook: application.hook,
	});
	const [to, setTo] = useState(
		application.recipient ?? application.contactEmails[0] ?? "",
	);
	const [subject, setSubject] = useState(
		application.emailSubject ?? draft.subject,
	);
	const [body, setBody] = useState(application.emailBody ?? draft.body);
	const [confirm, setConfirm] = useState(false);
	const fullName = application.cv?.fullName ?? "";
	const senderOk =
		Boolean(application.mailFrom) &&
		application.mailFrom === application.candidateEmail;
	const recipient = to.trim().toLowerCase();
	const recipientError = !recipient
		? "Saisis l’adresse du recruteur"
		: !EMAIL_PATTERN.test(recipient)
			? "Adresse invalide"
			: isBlockedRecipient(recipient)
				? "Adresse « no-reply » : personne ne la lira"
				: recipient === application.candidateEmail
					? "C’est ta propre adresse"
					: null;
	const limitReached = application.sentToday >= application.dailyLimit;
	const locked = application.status !== "validated";

	if (application.status === "sent") {
		const followUp = (application.sentAt ?? 0) + 7 * 24 * 60 * 60 * 1000;
		return (
			<Card className="gap-2 px-6">
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<Send className="size-4 text-success" />{" "}
					{application.sentVia === "portail"
						? "Envoyée sur le site de l’entreprise"
						: "Envoyée par email"}
				</h3>
				{application.sentVia === "portail" ? (
					<p className="text-sm text-muted-foreground">
						Le {sentFormat.format(application.sentAt ?? 0)} sur{" "}
						<span className="text-foreground">{application.recipient}</span>{" "}
						(détecté par l’extension).
					</p>
				) : (
					<p className="text-sm text-muted-foreground">
						Le {sentFormat.format(application.sentAt ?? 0)} à{" "}
						<span className="text-foreground">{application.recipient}</span>,
						depuis {application.sentFrom}. Une copie se trouve dans ta boîte «
						Envoyés ».
					</p>
				)}
				<p className="text-sm text-muted-foreground">
					Sans réponse, relance conseillée à partir du{" "}
					{new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
						followUp,
					)}
					.
				</p>
			</Card>
		);
	}

	async function send() {
		try {
			await requestSend({
				id: application._id,
				to: recipient,
				subject,
				body,
				confirmed: true,
			});
			toast.success("Envoi lancé", {
				description: `Destinataire : ${recipient}`,
			});
		} catch (error) {
			toast.error("Envoi refusé", { description: cleanError(error) });
		}
	}

	return (
		<Card
			className={cn(
				"gap-4 px-6",
				bare && "gap-4 border-0 bg-transparent p-0 shadow-none",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<Send className="size-4" /> Envoi par email
				</h3>
				<span className="text-xs text-muted-foreground">
					{application.sentToday} / {application.dailyLimit} envois sur 24 h
				</span>
			</div>
			{!senderOk && (
				<p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
					{application.mailFrom
						? `Le compte d’envoi du serveur (${application.mailFrom}) n’est pas celui de ${application.candidateEmail} : l’envoi depuis l’application est désactivé pour cette personne. Dépose les PDF sur le site de l’offre.`
						: "SMTP non configuré sur le serveur : envoi impossible."}
				</p>
			)}
			{application.sendError && (
				<p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{application.sendError}
				</p>
			)}
			{application.status === "ready" && (
				<p className="text-sm text-muted-foreground">
					Relis la lettre et les PDF, puis clique sur « Valider » pour pouvoir
					l’envoyer.
				</p>
			)}
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="grid gap-1.5">
					<Label className="text-xs text-muted-foreground">De</Label>
					<Input
						value={`${fullName} <${application.mailFrom ?? "?"}>`}
						disabled
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="send-to" className="text-xs text-muted-foreground">
						À
					</Label>
					<Input
						id="send-to"
						value={to}
						disabled={locked}
						placeholder="recrutement@entreprise.com"
						onChange={(event) => setTo(event.target.value)}
						aria-invalid={Boolean(to) && Boolean(recipientError)}
					/>
					{application.contactEmails.length > 0 ? (
						<div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
							Trouvé dans l’offre :
							{application.contactEmails.map((email) => (
								<button
									key={email}
									type="button"
									disabled={locked}
									onClick={() => setTo(email)}
									className="underline underline-offset-2 hover:text-foreground"
								>
									{email}
								</button>
							))}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							Aucune adresse dans l’offre : utilise celle d’un recruteur ou d’un
							contact (LinkedIn, salon…).
						</p>
					)}
				</div>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="send-subject" className="text-xs text-muted-foreground">
					Objet
				</Label>
				<Input
					id="send-subject"
					value={subject}
					disabled={locked}
					onChange={(event) => setSubject(event.target.value)}
				/>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="send-body" className="text-xs text-muted-foreground">
					Message
				</Label>
				<Textarea
					id="send-body"
					rows={11}
					value={body}
					disabled={locked}
					onChange={(event) => setBody(event.target.value)}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				Pièces jointes :
				<Badge variant="secondary" className="font-normal">
					<FileText /> {attachmentName("CV", fullName, application.jobTitle)}
				</Badge>
				<Badge variant="secondary" className="font-normal">
					<FileText />{" "}
					{attachmentName(
						"Lettre de motivation",
						fullName,
						application.jobTitle,
					)}
				</Badge>
			</div>
			<div className="flex flex-wrap items-center justify-end gap-2">
				{!locked && recipientError && to && (
					<span className="mr-auto text-xs text-destructive">
						{recipientError}
					</span>
				)}
				{application.status === "sending" && (
					<Button
						size="sm"
						variant="ghost"
						onClick={() =>
							void cancelSend({ id: application._id }).catch((error) =>
								toast.error("Annulation impossible", {
									description: cleanError(error),
								}),
							)
						}
					>
						Annuler l’envoi
					</Button>
				)}
				{["sending", "sending-busy"].includes(application.status) ? (
					<Button size="sm" disabled>
						<LoaderCircle className="animate-spin" /> Envoi en cours…
					</Button>
				) : (
					<Button
						size="sm"
						disabled={
							locked ||
							!senderOk ||
							Boolean(recipientError) ||
							limitReached ||
							!subject.trim() ||
							!body.trim()
						}
						onClick={() => setConfirm(true)}
					>
						<Send /> Envoyer…
					</Button>
				)}
			</div>

			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Envoyer cette candidature ?</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-2 text-sm">
								<p>Un vrai email va partir. Il ne pourra pas être rappelé.</p>
								<ul className="space-y-1 text-foreground">
									<li>
										<span className="text-muted-foreground">De :</span>{" "}
										{fullName} &lt;{application.mailFrom}&gt;
									</li>
									<li>
										<span className="text-muted-foreground">À :</span>{" "}
										{recipient}
									</li>
									<li>
										<span className="text-muted-foreground">Objet :</span>{" "}
										{subject}
									</li>
									<li>
										<span className="text-muted-foreground">
											Pièces jointes :
										</span>{" "}
										CV et lettre de motivation (PDF)
									</li>
								</ul>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Annuler</AlertDialogCancel>
						<AlertDialogAction onClick={() => void send()}>
							<Send /> Envoyer maintenant
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}

/** Version of extension/manifest.json: an older one asks for a reload. */
const EXTENSION_VERSION = "1.2.0";
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? "http://<serveur>:3210";

/** Tells whether the Chrome extension is installed (it marks <html>). */
function ExtensionHint() {
	const [version, setVersion] = useState<string | null>(null);
	useEffect(() => {
		const read = () =>
			setVersion(document.documentElement.dataset.marketRadarExtension ?? null);
		read();
		const timer = window.setTimeout(read, 800);
		return () => window.clearTimeout(timer);
	}, []);
	if (version && version !== EXTENSION_VERSION) {
		return (
			<p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
				<CircleAlert className="mt-0.5 size-4 shrink-0" />
				<span>
					Nouvelle version de l’extension (v{EXTENSION_VERSION}, Workday et
					création de compte). Ouvre <code>chrome://extensions</code> et clique
					↻ sur Market Radar, puis recharge cette page.
				</span>
			</p>
		);
	}
	if (version) {
		return (
			<p className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
				<Check className="mt-0.5 size-4 shrink-0" />
				<span>
					Extension prête (v{version}). « Postuler sur le site » ouvre le
					formulaire : connexion, remplissage, CV et lettre se font seuls. Tu
					n’as plus qu’à vérifier et cliquer « Envoyer » sur le site.
				</span>
			</p>
		);
	}
	return (
		<div className="rounded-md border border-dashed px-4 py-3 text-sm">
			<p className="font-medium">
				Installe l’extension Chrome (une seule fois)
			</p>
			<ol className="mt-1 list-inside list-decimal space-y-0.5 text-muted-foreground">
				<li>
					Ouvre <code className="text-foreground">chrome://extensions</code> et
					active le « Mode développeur » (en haut à droite).
				</li>
				<li>
					« Charger l’extension non empaquetée » → choisis le dossier{" "}
					<code className="text-foreground">market-radar/extension</code>.
				</li>
				<li>
					Clique sur l’icône Market Radar → « Réglages » : colle{" "}
					<code className="text-foreground">{CONVEX_URL}</code> et l’adresse de
					cette page, puis « Enregistrer » (Chrome demande l’accès).
				</li>
				<li>Recharge cette page : ce message devient vert.</li>
			</ol>
		</div>
	);
}
