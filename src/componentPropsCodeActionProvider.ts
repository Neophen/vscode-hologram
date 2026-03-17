import * as vscode from "vscode";
import { resolveComponentName } from "./holoDevResolver";
import type { WorkspaceIndex } from "./workspaceIndex";

export class ComponentPropsCodeActionProvider
	implements vscode.CodeActionProvider
{
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

	private index: WorkspaceIndex;

	constructor(index: WorkspaceIndex) {
		this.index = index;
	}

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		_context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.CodeAction[] {
		const tag = this.findEnclosingTag(document, range.start);
		if (!tag) return [];

		const fullName = resolveComponentName(tag.name, document) ?? tag.name;
		const mod =
			this.index.getModule(fullName) ||
			this.index.getModuleByShortName(tag.name);
		if (!mod || mod.props.length === 0) return [];

		const providedProps = this.getProvidedProps(document, tag);
		const missingProps = mod.props.filter((p) => !providedProps.has(p.name));

		if (missingProps.length === 0) return [];

		const actions: vscode.CodeAction[] = [];

		for (const prop of missingProps) {
			const value =
				prop.type === "string" ? `${prop.name}=""` : `${prop.name}={}`;
			const label = prop.hasDefault
				? `Add prop "${prop.name}" (${prop.type})`
				: `Add prop "${prop.name}" (${prop.type}, required)`;

			const action = new vscode.CodeAction(
				label,
				vscode.CodeActionKind.Refactor,
			);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.insert(document.uri, tag.insertPos, ` ${value}`);
			actions.push(action);
		}

		return actions;
	}

	private findEnclosingTag(
		document: vscode.TextDocument,
		position: vscode.Position,
	): { name: string; insertPos: vscode.Position } | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);

		// Search backward for the nearest `<`
		let tagStart = -1;
		for (let i = offset; i >= 0; i--) {
			if (text[i] === ">") return undefined; // cursor is outside a tag
			if (text[i] === "<") {
				tagStart = i;
				break;
			}
		}
		if (tagStart === -1) return undefined;

		// Match the component tag name (uppercase start)
		const tagText = text.substring(tagStart);
		const match = tagText.match(
			/^<([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/,
		);
		if (!match) return undefined;

		// Find where to insert: before `/>` or `>` at end of opening tag
		const tagEnd = tagText.indexOf(">");
		if (tagEnd === -1) return undefined;

		const selfClosing = tagText[tagEnd - 1] === "/";
		const insertOffset = tagStart + (selfClosing ? tagEnd - 1 : tagEnd);
		const insertPos = document.positionAt(insertOffset);

		return { name: match[1], insertPos };
	}

	private getProvidedProps(
		document: vscode.TextDocument,
		tag: { name: string; insertPos: vscode.Position },
	): Set<string> {
		const text = document.getText();
		const insertOffset = document.offsetAt(tag.insertPos);

		// Find the tag start to get the full tag content
		let tagStart = -1;
		for (let i = insertOffset; i >= 0; i--) {
			if (text[i] === "<") {
				tagStart = i;
				break;
			}
		}
		if (tagStart === -1) return new Set();

		const tagContent = text.substring(tagStart, insertOffset);
		const provided = new Set<string>();
		const attrPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
		for (const attrMatch of tagContent.matchAll(attrPattern)) {
			provided.add(attrMatch[1]);
		}

		return provided;
	}
}
