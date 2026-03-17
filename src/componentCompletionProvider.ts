import * as vscode from "vscode";
import type { ModuleInfo, WorkspaceIndex } from "./workspaceIndex";

export class ComponentCompletionProvider
	implements vscode.CompletionItemProvider
{
	private index: WorkspaceIndex;

	constructor(index: WorkspaceIndex) {
		this.index = index;
	}

	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
		_context: vscode.CompletionContext,
	): vscode.CompletionItem[] | undefined {
		if (!this.isInTemplateRegion(document, position)) {
			return undefined;
		}

		const line = document.lineAt(position.line).text;
		const textBefore = line.substring(0, position.character);

		// Match `<` followed by optional uppercase chars (user typing a component name)
		const tagMatch = textBefore.match(/<([A-Z][a-zA-Z0-9.]*)?$/);
		if (!tagMatch) return undefined;

		const aliases = this.getAliases(document);
		const components = this.index.getAllComponents();
		const items: vscode.CompletionItem[] = [];
		let sortIndex = 0;

		const typed = tagMatch[1] || "";
		const angleBracketPos = position.character - typed.length - 1;
		const replaceRange = new vscode.Range(
			new vscode.Position(position.line, angleBracketPos),
			position,
		);

		// Aliased components first
		for (const [fullName, mod] of components) {
			const alias = aliases.get(fullName);
			if (!alias) continue;

			const item = this.createCompletionItem(
				alias,
				fullName,
				mod,
				replaceRange,
				sortIndex++,
				false,
			);
			items.push(item);
		}

		// Non-aliased components
		for (const [fullName, mod] of components) {
			if (aliases.has(fullName)) continue;

			const item = this.createCompletionItem(
				fullName,
				fullName,
				mod,
				replaceRange,
				sortIndex++,
				true,
			);
			items.push(item);
		}

		return items;
	}

	private createCompletionItem(
		displayName: string,
		fullName: string,
		mod: ModuleInfo,
		replaceRange: vscode.Range,
		sortIndex: number,
		needsAlias: boolean,
	): vscode.CompletionItem {
		const shortName = fullName.split(".").pop() ?? fullName;
		const item = new vscode.CompletionItem(
			displayName,
			vscode.CompletionItemKind.Class,
		);

		const requiredProps = mod.props.filter((p) => !p.hasDefault);

		let detail = mod.kind === "page" ? "Page" : "Component";
		if (mod.props.length > 0) {
			const propNames = mod.props.map((p) =>
				p.hasDefault ? p.name : `${p.name}*`,
			);
			detail += ` (${propNames.join(", ")})`;
		}
		item.detail = detail;

		if (fullName !== displayName) {
			item.documentation = new vscode.MarkdownString(`**${fullName}**`);
		}

		item.sortText = String(sortIndex).padStart(4, "0");
		item.filterText = `<${displayName} ${fullName} ${shortName}`;
		item.range = replaceRange;

		// Build the snippet: <Name requiredProp={} /> with cursor positions
		const insertName = needsAlias ? shortName : displayName;
		let snippetIndex = 1;
		const propSnippets: string[] = [];

		for (const prop of requiredProps) {
			if (prop.type === "string") {
				propSnippets.push(`${prop.name}="\${${snippetIndex++}}"`);
			} else {
				propSnippets.push(`${prop.name}={\${${snippetIndex++}}}`);
			}
		}

		const propsStr =
			propSnippets.length > 0 ? ` ${propSnippets.join(" ")}` : "";
		const snippet = new vscode.SnippetString(`<${insertName}${propsStr} />`);
		item.insertText = snippet;

		if (needsAlias) {
			item.additionalTextEdits = this.buildAliasEdit(fullName, replaceRange);
		}

		return item;
	}

	private buildAliasEdit(
		fullName: string,
		_replaceRange: vscode.Range,
	): vscode.TextEdit[] {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return [];

		const document = editor.document;
		const text = document.getText();

		// Find the last alias line in the current module
		const lines = text.split("\n");
		let lastAliasLine = -1;
		let useHologramLine = -1;

		for (let i = 0; i < lines.length; i++) {
			if (/^\s*use\s+Hologram\.(Component|Page)\s*$/.test(lines[i])) {
				useHologramLine = i;
			}
			if (/^\s*alias\s+/.test(lines[i])) {
				lastAliasLine = i;
			}
		}

		// Insert after last alias, or after the `use` line
		const insertLine =
			lastAliasLine >= 0
				? lastAliasLine + 1
				: useHologramLine >= 0
					? useHologramLine + 2
					: -1;

		if (insertLine === -1) return [];

		const indent = lines[insertLine - 1]?.match(/^(\s*)/)?.[1] ?? "  ";
		const aliasText = `${indent}alias ${fullName}\n`;
		const insertPos = new vscode.Position(insertLine, 0);

		return [vscode.TextEdit.insert(insertPos, aliasText)];
	}

	private getAliases(document: vscode.TextDocument): Map<string, string> {
		const text = document.getText();
		const aliases = new Map<string, string>();

		// Simple alias: alias Foo.Bar.Baz
		const simpleAliasRegex = /^\s*alias\s+(\S+)\s*$/gm;
		for (const match of text.matchAll(simpleAliasRegex)) {
			const full = match[1];
			const parts = full.split(".");
			aliases.set(full, parts[parts.length - 1]);
		}

		// Group alias: alias Foo.Bar.{Baz, Qux}
		const groupAliasRegex = /^\s*alias\s+(\S+)\.\{([^}]+)\}/gm;
		for (const match of text.matchAll(groupAliasRegex)) {
			const base = match[1];
			for (const name of match[2].split(",").map((n) => n.trim())) {
				aliases.set(`${base}.${name}`, name);
			}
		}

		// Alias with as: alias Foo.Bar, as: MyBar
		const aliasAsRegex = /^\s*alias\s+(\S+),\s*as:\s*(\w+)\s*$/gm;
		for (const match of text.matchAll(aliasAsRegex)) {
			aliases.set(match[1], match[2]);
		}

		return aliases;
	}

	private isInTemplateRegion(
		document: vscode.TextDocument,
		position: vscode.Position,
	): boolean {
		if (document.languageId === "hologram") return true;

		if (document.languageId === "elixir") {
			const text = document.getText(
				new vscode.Range(new vscode.Position(0, 0), position),
			);
			const sigilStart = text.lastIndexOf("~HOLO");
			if (sigilStart === -1) return false;

			const afterSigil = text.substring(sigilStart + 5);
			if (afterSigil.startsWith('"""')) {
				const rest = afterSigil.substring(3);
				const matches = rest.match(/"""/g);
				return !matches || matches.length % 2 === 0;
			}
			if (afterSigil.startsWith('"')) {
				const rest = afterSigil.substring(1);
				const matches = rest.match(/(?<!\\)"/g);
				return !matches || matches.length % 2 === 0;
			}
			return true;
		}

		return false;
	}
}
