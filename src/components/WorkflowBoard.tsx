import {
	applyNodeChanges,
	Background,
	BackgroundVariant,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	MiniMap,
	type Node,
	type NodeChange,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import { useMutation, useQuery } from "convex/react";
import {
	Bot,
	Check,
	ChevronsUpDown,
	CircleStop,
	Database,
	FileCheck2,
	Hand,
	LayoutGrid,
	LoaderCircle,
	MousePointer2,
	Play,
	Plus,
	RotateCcw,
	Send,
	ShieldCheck,
	Sparkles,
	Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader, useDebounced } from "./shared";

type NodeKind = "source" | "logic" | "ai" | "data" | "action";
type NodeMode = "automatic" | "approval" | "manual";
type Step = {
	id: string;
	title: string;
	description: string;
	kind: NodeKind;
	status: "active" | "planned";
	mode: NodeMode;
	x: number;
	y: number;
};
type Link = { id: string; from: string; to: string; status: string };
type RunStep = {
	nodeId: string;
	status: string;
	output?: string;
	updatedAt: number;
};

const kindLabels: Record<NodeKind, string> = {
	source: "Déclencheur",
	logic: "Validation",
	ai: "IA locale",
	data: "Données",
	action: "Action",
};
const modeLabels: Record<NodeMode, string> = {
	automatic: "Automatique",
	approval: "Validation humaine",
	manual: "Manuel",
};
const runLabels: Record<string, string> = {
	pending: "À venir",
	ready: "Prête",
	processing: "Ollama travaille…",
	error: "Erreur",
	waiting_approval: "À valider",
	completed: "Terminée",
};

function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
	const Icon =
		kind === "source"
			? MousePointer2
			: kind === "logic"
				? FileCheck2
				: kind === "ai"
					? Bot
					: kind === "data"
						? Database
						: Send;
	return <Icon className={className} />;
}

type StepNodeData = Step & { run?: RunStep; current: boolean };

const StepNode = memo(function StepNode({
	data,
	selected,
}: NodeProps<Node<StepNodeData>>) {
	const status = data.run?.status;
	return (
		<div
			className={cn(
				"w-[230px] rounded-xl border bg-card p-3.5 text-card-foreground shadow-sm transition-shadow",
				selected && "ring-2 ring-foreground/20",
				data.current && "border-foreground/40 shadow-md",
				data.status === "planned" && !status && "border-dashed",
			)}
		>
			<Handle
				type="target"
				position={Position.Left}
				className="!size-2 !border-0 !bg-muted-foreground/50"
			/>
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"grid size-7 place-items-center rounded-md bg-muted",
						data.kind === "ai" && "bg-info-soft text-info",
						data.kind === "logic" && "bg-warning-soft text-warning",
					)}
				>
					<KindIcon kind={data.kind} className="size-3.5" />
				</span>
				<span className="text-xs text-muted-foreground">
					{kindLabels[data.kind]}
				</span>
				<span
					className={cn(
						"ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium",
						status === "completed" && "bg-success-soft text-success",
						status === "error" && "bg-destructive/10 text-destructive",
						(status === "processing" ||
							status === "ready" ||
							status === "waiting_approval") &&
							"bg-info-soft text-info",
						!status && data.status === "active" && "bg-muted text-foreground",
						!status && data.status === "planned" && "text-muted-foreground",
					)}
				>
					{status
						? runLabels[status]
						: data.status === "active"
							? "Connectée"
							: "À configurer"}
				</span>
			</div>
			<p className="mt-2.5 text-sm font-medium leading-snug">{data.title}</p>
			<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
				{data.description}
			</p>
			<div className="mt-2.5 flex items-center gap-1 text-[11px] text-muted-foreground">
				{data.mode === "approval" ? (
					<ShieldCheck className="size-3" />
				) : data.mode === "automatic" ? (
					<Sparkles className="size-3" />
				) : (
					<Hand className="size-3" />
				)}
				{modeLabels[data.mode]}
			</div>
			<Handle
				type="source"
				position={Position.Right}
				className="!size-2 !border-0 !bg-muted-foreground/50"
			/>
		</div>
	);
});

const nodeTypes = { step: StepNode };

export function WorkflowBoard({ profileId }: { profileId?: string }) {
	return (
		<ReactFlowProvider>
			<Board profileId={profileId} />
		</ReactFlowProvider>
	);
}

function Board({ profileId }: { profileId?: string }) {
	const workflow = useQuery(api.workflows.getDefault);
	const ensureDefault = useMutation(api.workflows.ensureDefault);
	const saveWorkflow = useMutation(api.workflows.update);
	const latestRun = useQuery(
		api.workflows.latestRun,
		workflow ? { workflowId: workflow._id } : "skip",
	);
	const [steps, setSteps] = useState<Step[]>([]);
	const [links, setLinks] = useState<Link[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
		"saved",
	);
	const [dirty, setDirty] = useState(false);
	const loadedId = useRef<string | null>(null);
	const { fitView } = useReactFlow();

	useEffect(() => {
		if (workflow === null) void ensureDefault();
	}, [ensureDefault, workflow]);

	useEffect(() => {
		if (!workflow || loadedId.current === workflow._id) return;
		loadedId.current = workflow._id;
		setSteps(workflow.nodes as Step[]);
		setLinks(workflow.edges);
	}, [workflow]);

	useEffect(() => {
		if (!dirty || !workflow) return;
		setSaveState("saving");
		const timer = window.setTimeout(() => {
			setDirty(false);
			saveWorkflow({
				workflowId: workflow._id,
				name: workflow.name,
				nodes: steps.map((step) => ({
					...step,
					x: Math.round(step.x),
					y: Math.round(step.y),
				})),
				edges: links,
			})
				.then(() => setSaveState("saved"))
				.catch(() => {
					setSaveState("error");
					setDirty(true);
				});
		}, 600);
		return () => window.clearTimeout(timer);
	}, [dirty, links, saveWorkflow, steps, workflow]);

	const runActive = latestRun?.status === "running";
	const runSteps = useMemo(
		() =>
			new Map<string, RunStep>(
				latestRun && latestRun.status !== "cancelled"
					? latestRun.steps.map((step) => [step.nodeId, step])
					: [],
			),
		[latestRun],
	);

	// React Flow keeps measured sizes on its node objects, so nodes live in
	// their own state and are re-synced from the saved steps.
	const [nodes, setNodes] = useState<Node<StepNodeData>[]>([]);
	useEffect(() => {
		setNodes((previous) =>
			steps.map((step) => {
				const old = previous.find((node) => node.id === step.id);
				return {
					...old,
					id: step.id,
					type: "step",
					position: { x: step.x, y: step.y },
					selected: step.id === selectedId,
					data: {
						...step,
						run: runSteps.get(step.id),
						current: runActive && latestRun?.currentNodeId === step.id,
					},
				};
			}),
		);
	}, [steps, selectedId, runSteps, runActive, latestRun?.currentNodeId]);
	const edges: Edge[] = useMemo(
		() =>
			links.map((link) => {
				const done = runSteps.get(link.from)?.status === "completed";
				return {
					id: link.id,
					source: link.from,
					target: link.to,
					type: "smoothstep",
					animated: runActive && latestRun?.currentNodeId === link.to,
					markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
					style: {
						strokeWidth: 1.5,
						strokeDasharray:
							link.status === "active" || done ? undefined : "5 5",
						stroke: done ? "var(--success)" : undefined,
					},
				};
			}),
		[links, runSteps, runActive, latestRun?.currentNodeId],
	);

	const onNodesChange = useCallback(
		(changes: NodeChange<Node<StepNodeData>>[]) => {
			setNodes((current) => applyNodeChanges(changes, current));
			for (const change of changes) {
				if (change.type === "select" && change.selected)
					setSelectedId(change.id);
			}
		},
		[],
	);

	function updateStep(id: string, patch: Partial<Step>) {
		setSteps((current) =>
			current.map((step) => (step.id === id ? { ...step, ...patch } : step)),
		);
		setDirty(true);
	}

	function addStep() {
		const anchor = steps.find((step) => step.id === selectedId) ?? steps.at(-1);
		const id = `step-${Date.now()}`;
		setSteps((current) => [
			...current,
			{
				id,
				title: "Nouvelle étape",
				description: "Décris le résultat attendu et l’outil à utiliser.",
				kind: "action",
				status: "planned",
				mode: "manual",
				x: (anchor?.x ?? 0) + 60,
				y: (anchor?.y ?? 0) + 200,
			},
		]);
		if (anchor) {
			setLinks((current) => {
				const outgoing = current.find((link) => link.from === anchor.id);
				const rest = outgoing
					? current.filter((link) => link.id !== outgoing.id)
					: current;
				return [
					...rest,
					{
						id: `${anchor.id}-${id}`,
						from: anchor.id,
						to: id,
						status: "planned",
					},
					...(outgoing
						? [
								{
									id: `${id}-${outgoing.to}`,
									from: id,
									to: outgoing.to,
									status: "planned",
								},
							]
						: []),
				];
			});
		}
		setSelectedId(id);
		setDirty(true);
	}

	function removeStep(id: string) {
		const incoming = links.find((link) => link.to === id);
		const outgoing = links.find((link) => link.from === id);
		setSteps((current) => current.filter((step) => step.id !== id));
		setLinks((current) => {
			const next = current.filter((link) => link.from !== id && link.to !== id);
			if (incoming && outgoing)
				next.push({
					id: `${incoming.from}-${outgoing.to}`,
					from: incoming.from,
					to: outgoing.to,
					status: "planned",
				});
			return next;
		});
		setSelectedId(null);
		setDirty(true);
	}

	function arrange() {
		const incoming = new Set(links.map((link) => link.to));
		const order: string[] = [];
		let current = steps.find((step) => !incoming.has(step.id))?.id;
		while (current && !order.includes(current)) {
			order.push(current);
			current = links.find((link) => link.from === current)?.to;
		}
		for (const step of steps) if (!order.includes(step.id)) order.push(step.id);
		setSteps((list) =>
			list.map((step) => {
				const index = order.indexOf(step.id);
				const row = Math.floor(index / 4);
				const column = row % 2 === 0 ? index % 4 : 3 - (index % 4);
				return { ...step, x: column * 300, y: row * 230 };
			}),
		);
		setDirty(true);
		window.setTimeout(() => void fitView({ padding: 0.15, duration: 300 }), 50);
	}

	const selected = steps.find((step) => step.id === selectedId) ?? null;

	if (!workflow || !steps.length) {
		return (
			<div>
				<SectionHeader title="Workflow" description="Préparation…" />
				<Skeleton className="h-[640px]" />
			</div>
		);
	}

	return (
		<div>
			<SectionHeader
				title="Workflow"
				description="Annonce → analyse → CV → validation → message → validation → envoi → relance. Chaque envoi exige ta validation explicite."
				actions={
					<span className="text-xs text-muted-foreground">
						{saveState === "saving"
							? "Enregistrement…"
							: saveState === "error"
								? "Erreur d’enregistrement"
								: "Enregistré dans Convex"}
					</span>
				}
			/>

			<RunBar
				workflowId={workflow._id}
				profileId={profileId}
				run={latestRun ?? null}
				steps={steps}
			/>

			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
				<Card className="relative h-[640px] overflow-hidden p-0">
					<div className="absolute top-3 left-3 z-10 flex gap-1.5">
						<Button
							size="sm"
							variant="outline"
							className="bg-card"
							onClick={addStep}
						>
							<Plus /> Étape
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="bg-card"
							onClick={arrange}
						>
							<LayoutGrid /> Organiser
						</Button>
					</div>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						nodeTypes={nodeTypes}
						onNodesChange={onNodesChange}
						onNodeDragStop={(_, _node, dragged) => {
							setSteps((list) =>
								list.map((step) => {
									const moved = dragged.find((node) => node.id === step.id);
									return moved
										? { ...step, x: moved.position.x, y: moved.position.y }
										: step;
								}),
							);
							setDirty(true);
						}}
						onPaneClick={() => setSelectedId(null)}
						nodesConnectable={false}
						edgesFocusable={false}
						deleteKeyCode={null}
						fitView
						fitViewOptions={{ padding: 0.15 }}
						minZoom={0.3}
						maxZoom={1.6}
						proOptions={{ hideAttribution: true }}
					>
						<Background variant={BackgroundVariant.Dots} gap={18} size={1} />
						<Controls showInteractive={false} position="bottom-left" />
						<MiniMap
							pannable
							zoomable
							position="bottom-right"
							className="!rounded-lg !border"
							nodeColor="var(--border)"
							nodeStrokeColor="var(--muted-foreground)"
							nodeBorderRadius={6}
							style={{ width: 150, height: 96 }}
							maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
						/>
					</ReactFlow>
				</Card>

				<Inspector
					step={selected}
					run={latestRun ?? null}
					runStep={selected ? runSteps.get(selected.id) : undefined}
					onChange={(patch) => selected && updateStep(selected.id, patch)}
					onRemove={() => selected && removeStep(selected.id)}
					runSteps={runSteps}
					steps={steps}
				/>
			</div>
		</div>
	);
}

function RunBar({
	workflowId,
	profileId,
	run,
	steps,
}: {
	workflowId: Id<"workflows">;
	profileId?: string;
	run: {
		_id: Id<"workflowRuns">;
		status: string;
		jobTitle: string;
		currentNodeId?: string;
		steps: RunStep[];
	} | null;
	steps: Step[];
}) {
	const startRun = useMutation(api.workflows.startRun);
	const advanceRun = useMutation(api.workflows.advanceRun);
	const cancelRun = useMutation(api.workflows.cancelRun);
	const retryStep = useMutation(api.workflows.retryStep);
	const [busy, setBusy] = useState(false);
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [jobId, setJobId] = useState<Id<"jobs"> | null>(null);
	const [jobLabel, setJobLabel] = useState("");
	const debounced = useDebounced(search);
	const jobs = useQuery(
		api.jobs.radar,
		profileId
			? { profileId, search: debounced, pageSize: 20, scope: "relevant" }
			: "skip",
	);

	const running = run?.status === "running";
	const current = steps.find((step) => step.id === run?.currentNodeId);
	const currentRun = run?.steps.find(
		(step) => step.nodeId === run.currentNodeId,
	);
	const done =
		run?.steps.filter((step) => step.status === "completed").length ?? 0;
	const total = run?.steps.length ?? 0;
	const aiWorking =
		current?.mode === "automatic" &&
		current.status === "active" &&
		(currentRun?.status === "ready" || currentRun?.status === "processing");
	const stuck =
		currentRun?.status === "processing" &&
		Date.now() - currentRun.updatedAt > 3 * 60_000;

	async function act(action: () => Promise<unknown>) {
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.error("Action impossible", {
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setBusy(false);
		}
	}

	if (running && run) {
		const isSend = current?.id === "send";
		return (
			<Card className="flex-row flex-wrap items-center gap-4 px-4 py-3">
				<div className="min-w-0 flex-1">
					<p className="text-xs text-muted-foreground">Candidature en cours</p>
					<p className="truncate font-medium">{run.jobTitle}</p>
				</div>
				<div className="w-full sm:w-56">
					<div className="mb-1 flex justify-between text-xs text-muted-foreground">
						<span className="truncate">{current?.title ?? "Finalisation"}</span>
						<span className="tabular">
							{done}/{total}
						</span>
					</div>
					<Progress
						value={total ? (done / total) * 100 : 0}
						className="h-1.5"
					/>
				</div>
				<div className="flex gap-2">
					{currentRun?.status === "error" || stuck ? (
						<Button
							size="sm"
							disabled={busy}
							onClick={() => act(() => retryStep({ runId: run._id }))}
						>
							<RotateCcw /> Relancer l’analyse
						</Button>
					) : aiWorking ? (
						<Button size="sm" disabled>
							<LoaderCircle className="animate-spin" /> Ollama analyse…
						</Button>
					) : (
						<Button
							size="sm"
							disabled={busy || !run.currentNodeId}
							onClick={() =>
								act(() =>
									advanceRun({
										runId: run._id,
										nodeId: run.currentNodeId as string,
										output:
											current?.mode === "approval"
												? "Approuvé manuellement"
												: isSend
													? "Marquée comme envoyée manuellement (aucun email n’est parti depuis l’application)"
													: "Étape terminée manuellement",
									}),
								)
							}
						>
							{current?.mode === "approval" ? <Check /> : <Play />}
							{current?.mode === "approval"
								? "Approuver"
								: isSend
									? "Marquer comme envoyée"
									: "Terminer l’étape"}
						</Button>
					)}
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => act(() => cancelRun({ runId: run._id }))}
						aria-label="Arrêter la candidature"
					>
						<CircleStop />
					</Button>
				</div>
			</Card>
		);
	}

	return (
		<Card className="flex-row flex-wrap items-center gap-3 px-4 py-3">
			<div className="mr-auto min-w-0">
				<p className="text-sm font-medium">Démarrer une candidature</p>
				<p className="text-xs text-muted-foreground">
					Choisis une offre pertinente du profil actif (ou depuis le Radar).
				</p>
			</div>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						className="w-full justify-between font-normal sm:w-96"
					>
						<span className="truncate">{jobLabel || "Choisir une offre…"}</span>
						<ChevronsUpDown className="opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-[--radix-popover-trigger-width] min-w-80 p-0"
					align="end"
				>
					<Command shouldFilter={false}>
						<CommandInput
							placeholder="Rechercher une offre…"
							value={search}
							onValueChange={setSearch}
						/>
						<CommandList>
							<CommandEmpty>
								{jobs ? "Aucune offre." : "Chargement…"}
							</CommandEmpty>
							<CommandGroup>
								{jobs?.items.map((job) => (
									<CommandItem
										key={job._id}
										value={job._id}
										onSelect={() => {
											setJobId(job._id);
											setJobLabel(`${job.title} · ${job.displayCompany}`);
											setOpen(false);
										}}
									>
										<div className="min-w-0 flex-1">
											<p className="truncate">{job.title}</p>
											<p className="truncate text-xs text-muted-foreground">
												{job.displayCompany}
											</p>
										</div>
										<span className="tabular text-xs">{job.profileScore}</span>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			<Button
				disabled={!jobId || busy}
				onClick={() => jobId && act(() => startRun({ workflowId, jobId }))}
			>
				<Play /> Démarrer
			</Button>
		</Card>
	);
}

function Inspector({
	step,
	run,
	runStep,
	onChange,
	onRemove,
	runSteps,
	steps,
}: {
	step: Step | null;
	run: { status: string; jobTitle: string } | null;
	runStep?: RunStep;
	onChange: (patch: Partial<Step>) => void;
	onRemove: () => void;
	runSteps: Map<string, RunStep>;
	steps: Step[];
}) {
	if (!step) {
		const outputs = steps
			.map((item) => ({ step: item, run: runSteps.get(item.id) }))
			.filter((item) => item.run?.output);
		return (
			<Card className="h-[640px] gap-0 overflow-hidden py-0">
				<div className="border-b px-4 py-3">
					<p className="text-sm font-medium">Résultats</p>
					<p className="text-xs text-muted-foreground">
						{run ? run.jobTitle : "Aucune candidature en cours"}
					</p>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<div className="space-y-4 p-4">
						{outputs.length ? (
							outputs.map(({ step: item, run: result }) => (
								<div key={item.id}>
									<p className="mb-1 flex items-center gap-1.5 text-xs font-medium">
										<KindIcon kind={item.kind} className="size-3" />{" "}
										{item.title}
									</p>
									<p className="whitespace-pre-line text-sm text-muted-foreground">
										{result?.output}
									</p>
								</div>
							))
						) : (
							<p className="text-sm text-muted-foreground">
								Sélectionne une étape pour la configurer. Les résultats (dont
								l’analyse Ollama) s’affichent ici pendant une candidature.
							</p>
						)}
					</div>
				</ScrollArea>
			</Card>
		);
	}
	return (
		<Card className="h-[640px] gap-0 overflow-hidden py-0">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<p className="text-sm font-medium">Étape</p>
				<Badge variant={step.status === "active" ? "secondary" : "outline"}>
					{step.status === "active" ? "Connectée" : "À configurer"}
				</Badge>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="grid gap-4 p-4">
					{runStep?.output && (
						<div className="rounded-lg border bg-muted/40 p-3">
							<p className="mb-1 text-xs font-medium">
								Résultat · {runLabels[runStep.status] ?? runStep.status}
							</p>
							<p className="whitespace-pre-line text-sm text-muted-foreground">
								{runStep.output}
							</p>
						</div>
					)}
					<div className="grid gap-2">
						<Label htmlFor="step-title">Nom</Label>
						<Input
							id="step-title"
							value={step.title}
							onChange={(event) => onChange({ title: event.target.value })}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="step-description">Description</Label>
						<Textarea
							id="step-description"
							rows={3}
							value={step.description}
							onChange={(event) =>
								onChange({ description: event.target.value })
							}
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-2">
							<Label>Type</Label>
							<Select
								value={step.kind}
								onValueChange={(kind) => onChange({ kind: kind as NodeKind })}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(kindLabels).map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label>Exécution</Label>
							<Select
								value={step.mode}
								onValueChange={(mode) => onChange({ mode: mode as NodeMode })}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(modeLabels).map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="grid gap-2">
						<Label>Connecteur</Label>
						<Select
							value={step.status}
							onValueChange={(status) =>
								onChange({ status: status as Step["status"] })
							}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="active">Connecté</SelectItem>
								<SelectItem value="planned">À configurer</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Seule l’analyse d’annonce est branchée sur Ollama. Les autres
							étapes se valident à la main.
						</p>
					</div>
					<Separator />
					<p className="flex gap-2 text-xs text-muted-foreground">
						<ShieldCheck className="size-4 shrink-0" />
						Une étape « Validation humaine » bloque le flux jusqu’à ton action.
						Aucun email de candidature n’est envoyé automatiquement.
					</p>
					<Button
						variant="outline"
						className="text-destructive"
						onClick={onRemove}
					>
						<Trash2 /> Supprimer l’étape
					</Button>
				</div>
			</ScrollArea>
		</Card>
	);
}
