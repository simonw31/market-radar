import { useMutation, useQuery } from "convex/react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "../../convex/_generated/api";
import {
	BLOCK_TAGS,
	defaultLetterSettings,
	type FormDefaults,
	type LetterBlock,
	type LetterSettings,
} from "../../convex/lib/application";

const CONTRACTS = ["Alternance", "Stage", "CDI", "CDD", "VIE"];
const tagLabels: Record<string, string> = {
	tech: "Tech",
	data: "Data",
	projet: "Projet",
	gestion: "Gestion",
	finance: "Finance",
	marches: "Marchés",
	"relation-client": "Relation client",
	entrepreneuriat: "Entrepreneuriat",
	formation: "Formation",
};

let blockSequence = 0;

/** Button + sheet to edit the human-written pieces the letters are built from. */
export function LetterLibraryButton({ email }: { email: string }) {
	const candidate = useQuery(api.candidates.get, email ? { email } : "skip");
	const [open, setOpen] = useState(false);
	const count = candidate?.letterBlocks?.length ?? 0;
	return (
		<>
			<Button size="sm" variant="outline" onClick={() => setOpen(true)}>
				Bibliothèque de la lettre · {count} paragraphe{count > 1 ? "s" : ""}
			</Button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent className="w-full gap-0 sm:max-w-2xl">
					{open && candidate !== undefined && (
						<LibraryEditor
							email={email}
							initialBlocks={candidate?.letterBlocks ?? []}
							initialSettings={
								candidate?.letterSettings ?? defaultLetterSettings()
							}
							initialForm={candidate?.formDefaults ?? {}}
							onDone={() => setOpen(false)}
						/>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}

function LibraryEditor({
	email,
	initialBlocks,
	initialSettings,
	initialForm,
	onDone,
}: {
	email: string;
	initialBlocks: LetterBlock[];
	initialSettings: LetterSettings;
	initialForm: FormDefaults;
	onDone: () => void;
}) {
	const save = useMutation(api.candidates.saveLetterLibrary);
	const [blocks, setBlocks] = useState(initialBlocks);
	const [settings, setSettings] = useState(initialSettings);
	const [form, setForm] = useState(initialForm);
	const [saving, setSaving] = useState(false);

	function updateBlock(id: string, patch: Partial<LetterBlock>) {
		setBlocks((current) =>
			current.map((block) =>
				block.id === id ? { ...block, ...patch } : block,
			),
		);
	}
	function availability(contract: string) {
		return (
			settings.availability.find((item) => item.contract === contract)?.text ??
			""
		);
	}
	function setAvailability(contract: string, text: string) {
		setSettings((current) => ({
			...current,
			availability: [
				...current.availability.filter((item) => item.contract !== contract),
				...(text.trim() ? [{ contract, text }] : []),
			],
		}));
	}

	async function submit() {
		setSaving(true);
		try {
			await save({
				email,
				blocks,
				settings,
				formDefaults: Object.fromEntries(
					Object.entries(form)
						.map(([key, value]) => [
							key,
							typeof value === "string" ? value.trim() : value,
						])
						.filter(([, value]) =>
							Array.isArray(value) ? value.length : value,
						),
				) as FormDefaults,
			});
			toast.success("Bibliothèque enregistrée");
			onDone();
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

	return (
		<>
			<SheetHeader className="border-b pr-12">
				<SheetTitle>Bibliothèque de la lettre · {email}</SheetTitle>
				<SheetDescription>
					Écris ces textes une fois. Pour chaque offre, l’IA locale choisit les
					2 paragraphes les plus pertinents et n’écrit qu’une phrase d’accroche.
				</SheetDescription>
			</SheetHeader>
			<ScrollArea className="min-h-0 flex-1">
				<div className="grid gap-8 p-4">
					<section className="grid gap-3">
						<h3 className="text-sm font-semibold">Phrases fixes</h3>
						<Separator />
						<div className="grid gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Situation (début de la lettre)
							</Label>
							<Input
								value={settings.situation}
								placeholder="Actuellement en Master … à …"
								onChange={(event) =>
									setSettings({ ...settings, situation: event.target.value })
								}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Ville (date de la lettre)
							</Label>
							<Input
								value={settings.place}
								onChange={(event) =>
									setSettings({ ...settings, place: event.target.value })
								}
							/>
						</div>
						{CONTRACTS.map((contract) => (
							<div key={contract} className="grid gap-1.5">
								<Label className="text-xs text-muted-foreground">
									Disponibilité · {contract} (facultatif)
								</Label>
								<Input
									value={availability(contract)}
									placeholder={`Je suis disponible pour ${contract === "Stage" || contract === "Alternance" ? `une ${contract.toLowerCase()}` : `un ${contract}`} à partir de …`}
									onChange={(event) =>
										setAvailability(contract, event.target.value)
									}
								/>
							</div>
						))}
						<div className="grid gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Conclusion
							</Label>
							<Textarea
								rows={2}
								value={settings.closing}
								onChange={(event) =>
									setSettings({ ...settings, closing: event.target.value })
								}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label className="text-xs text-muted-foreground">
								Formule de politesse
							</Label>
							<Textarea
								rows={2}
								value={settings.politeness}
								onChange={(event) =>
									setSettings({ ...settings, politeness: event.target.value })
								}
							/>
						</div>
					</section>

					<section className="grid gap-3">
						<h3 className="text-sm font-semibold">Formulaires en ligne</h3>
						<Separator />
						<p className="text-xs text-muted-foreground">
							Réponses que l’extension Chrome remplit sur les sites de
							candidature (CA-CIB, Workday…). Tout est facultatif.
						</p>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="grid gap-1.5">
								<Label className="text-xs text-muted-foreground">
									Civilité
								</Label>
								<ToggleGroup
									type="single"
									variant="outline"
									value={form.civility ?? ""}
									onValueChange={(civility) => setForm({ ...form, civility })}
								>
									<ToggleGroupItem value="M." className="px-4">
										M.
									</ToggleGroupItem>
									<ToggleGroupItem value="Mme" className="px-4">
										Mme
									</ToggleGroupItem>
								</ToggleGroup>
							</div>
							{(
								[
									["birthDate", "Date de naissance", "JJ/MM/AAAA"],
									["nationality", "Nationalité", "Française"],
									["startDate", "Date de début souhaitée", "JJ/MM/AAAA"],
									["contractLength", "Durée (mois)", "12"],
									[
										"availability",
										"Disponibilité (texte libre)",
										"Septembre 2026",
									],
									["salary", "Prétentions salariales", "Selon grille"],
									["heardFrom", "Comment as-tu connu l’offre ?", "Site CACIB"],
								] as const
							).map(([key, label, placeholder]) => (
								<div key={key} className="grid gap-1.5">
									<Label className="text-xs text-muted-foreground">
										{label}
									</Label>
									<Input
										value={form[key] ?? ""}
										placeholder={placeholder}
										onChange={(event) =>
											setForm({ ...form, [key]: event.target.value })
										}
									/>
								</div>
							))}
							<div className="grid gap-1.5">
								<Label className="text-xs text-muted-foreground">
									Niveau de ta formation actuelle
								</Label>
								<ToggleGroup
									type="single"
									variant="outline"
									value={form.educationLevel ?? ""}
									onValueChange={(educationLevel) =>
										setForm({ ...form, educationLevel })
									}
									className="flex-wrap"
								>
									{["Bac + 3 / L3", "Bac + 4 / M1", "Bac + 5 / M2"].map(
										(level) => (
											<ToggleGroupItem
												key={level}
												value={level}
												className="px-3 text-xs"
											>
												{level}
											</ToggleGroupItem>
										),
									)}
								</ToggleGroup>
							</div>
							<div className="grid gap-1.5">
								<Label className="text-xs text-muted-foreground">
									Niveau d’expérience
								</Label>
								<ToggleGroup
									type="single"
									variant="outline"
									value={form.experienceLevel ?? ""}
									onValueChange={(experienceLevel) =>
										setForm({ ...form, experienceLevel })
									}
									className="flex-wrap"
								>
									{["0 - 2 ans", "3 - 5 ans", "6 - 10 ans"].map((level) => (
										<ToggleGroupItem
											key={level}
											value={level}
											className="px-3 text-xs"
										>
											{level}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</div>
							<div className="grid gap-1.5 sm:col-span-2">
								<Label className="text-xs text-muted-foreground">
									Mobilité géographique
								</Label>
								<ToggleGroup
									type="multiple"
									variant="outline"
									value={form.mobility ?? []}
									onValueChange={(mobility) => setForm({ ...form, mobility })}
									className="flex-wrap"
								>
									{["Europe", "Amérique", "Asie", "Afrique", "Océanie"].map(
										(zone) => (
											<ToggleGroupItem
												key={zone}
												value={zone}
												className="px-3 text-xs"
											>
												{zone}
											</ToggleGroupItem>
										),
									)}
								</ToggleGroup>
							</div>
						</div>
					</section>

					<section className="grid gap-3">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-semibold">Paragraphes</h3>
							<Button
								size="xs"
								variant="ghost"
								onClick={() =>
									setBlocks((current) => [
										...current,
										{
											id: `bloc-${Date.now()}-${++blockSequence}`,
											title: "",
											text: "",
											tags: [],
										},
									])
								}
							>
								<Plus /> Ajouter
							</Button>
						</div>
						<Separator />
						<p className="text-xs text-muted-foreground">
							Un paragraphe = une facette de ton parcours, rédigée à la première
							personne, avec uniquement des faits vrais. Les thèmes aident l’IA
							à choisir.
						</p>
						{blocks.map((block) => (
							<div
								key={block.id}
								className="relative grid gap-3 rounded-lg border p-3 pr-10"
							>
								<Button
									size="icon-xs"
									variant="ghost"
									className="absolute top-2 right-2 text-muted-foreground"
									onClick={() =>
										setBlocks((current) =>
											current.filter((item) => item.id !== block.id),
										)
									}
									aria-label="Supprimer le paragraphe"
								>
									<Trash2 />
								</Button>
								<Input
									value={block.title}
									placeholder="Titre (pour toi)"
									onChange={(event) =>
										updateBlock(block.id, { title: event.target.value })
									}
								/>
								<Textarea
									rows={4}
									value={block.text}
									placeholder="Avant de reprendre mes études, j’ai…"
									onChange={(event) =>
										updateBlock(block.id, { text: event.target.value })
									}
								/>
								<Input
									value={block.takeaway ?? ""}
									placeholder="Ce que ça t’apporte, ex. « la rigueur du pilotage par les chiffres »"
									onChange={(event) =>
										updateBlock(block.id, { takeaway: event.target.value })
									}
								/>
								<ToggleGroup
									type="multiple"
									variant="outline"
									size="sm"
									value={block.tags}
									onValueChange={(tags) => updateBlock(block.id, { tags })}
									className="flex-wrap"
								>
									{BLOCK_TAGS.map((tag) => (
										<ToggleGroupItem
											key={tag}
											value={tag}
											className="px-2.5 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background"
										>
											{tagLabels[tag]}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
								<span className="text-right text-xs text-muted-foreground">
									{block.text.length} / 1 200
								</span>
							</div>
						))}
					</section>
				</div>
			</ScrollArea>
			<SheetFooter className="flex-row justify-end gap-2 border-t">
				<Button variant="ghost" onClick={onDone}>
					Annuler
				</Button>
				<Button onClick={submit} disabled={saving}>
					{saving && <LoaderCircle className="animate-spin" />}
					Enregistrer
				</Button>
			</SheetFooter>
		</>
	);
}
