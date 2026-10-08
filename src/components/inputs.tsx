import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Chips input: Enter, comma, semicolon or Tab commits a value; paste splits
 * lists; Backspace on an empty field removes the last chip.
 */
export function TagInput({
	id,
	value,
	onChange,
	placeholder,
	validate,
	separators = /[,;\n]+/,
	"aria-invalid": ariaInvalid,
}: {
	id?: string;
	value: string[];
	onChange: (next: string[]) => void;
	placeholder?: string;
	validate?: (tag: string) => boolean;
	separators?: RegExp;
	"aria-invalid"?: boolean;
}) {
	const [draft, setDraft] = useState("");
	function commit(raw: string) {
		const parts = raw
			.split(separators)
			.map((part) => part.trim())
			.filter(Boolean);
		if (!parts.length) return;
		const next = [...value];
		for (const part of parts) {
			if (!next.some((item) => item.toLowerCase() === part.toLowerCase()))
				next.push(part);
		}
		onChange(next);
		setDraft("");
	}
	return (
		<div
			className={cn(
				"flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
				ariaInvalid && "border-destructive ring-destructive/20",
			)}
		>
			{value.map((tag) => (
				<Badge
					key={tag}
					variant={validate && !validate(tag) ? "destructive" : "secondary"}
					className="h-6 gap-1 rounded-md pr-1 font-normal"
				>
					{tag}
					<button
						type="button"
						onClick={() => onChange(value.filter((item) => item !== tag))}
						className="rounded-sm opacity-60 hover:opacity-100"
						aria-label={`Retirer ${tag}`}
					>
						<X className="size-3" />
					</button>
				</Badge>
			))}
			<input
				id={id}
				value={draft}
				placeholder={value.length ? "" : placeholder}
				onChange={(event) => {
					const next = event.target.value;
					if (separators.test(next)) commit(next);
					else setDraft(next);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || (event.key === "Tab" && draft)) {
						event.preventDefault();
						commit(draft);
					} else if (event.key === "Backspace" && !draft && value.length) {
						onChange(value.slice(0, -1));
					}
				}}
				onBlur={() => commit(draft)}
				onPaste={(event) => {
					const text = event.clipboardData.getData("text");
					if (separators.test(text) || /\s/.test(text.trim())) {
						event.preventDefault();
						commit(text);
					}
				}}
				className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
			/>
		</div>
	);
}

export function CompanyPicker({
	options,
	value,
	onChange,
}: {
	options: Array<{ name: string; sector?: string }>;
	value: string[];
	onChange: (next: string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const selected = new Set(value);
	const sectors = [
		...new Set(options.map((option) => option.sector ?? "Autres")),
	];
	return (
		<div className="flex flex-col gap-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between font-normal sm:w-80"
					>
						{value.length
							? `${value.length} entreprise${value.length > 1 ? "s" : ""} sélectionnée${value.length > 1 ? "s" : ""}`
							: "Choisir des entreprises"}
						<ChevronsUpDown className="opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0" align="start">
					<Command>
						<CommandInput placeholder="Rechercher une entreprise…" />
						<CommandList>
							<CommandEmpty>Aucune entreprise.</CommandEmpty>
							{sectors.map((sector) => (
								<CommandGroup key={sector} heading={sector}>
									{options
										.filter((option) => (option.sector ?? "Autres") === sector)
										.map((option) => (
											<CommandItem
												key={option.name}
												value={option.name}
												onSelect={() =>
													onChange(
														selected.has(option.name)
															? value.filter((item) => item !== option.name)
															: [...value, option.name],
													)
												}
											>
												<Check
													className={cn(
														"size-4",
														selected.has(option.name)
															? "opacity-100"
															: "opacity-0",
													)}
												/>
												{option.name}
											</CommandItem>
										))}
								</CommandGroup>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{value.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{value.map((company) => (
						<Badge
							key={company}
							variant="secondary"
							className="h-6 gap-1 rounded-md pr-1 font-normal"
						>
							{company}
							<button
								type="button"
								onClick={() =>
									onChange(value.filter((item) => item !== company))
								}
								className="rounded-sm opacity-60 hover:opacity-100"
								aria-label={`Retirer ${company}`}
							>
								<X className="size-3" />
							</button>
						</Badge>
					))}
				</div>
			)}
		</div>
	);
}
