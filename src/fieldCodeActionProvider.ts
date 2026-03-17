import * as vscode from "vscode";

export class FieldCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source !== "HoloDev") continue;

			switch (diagnostic.code) {
				case "unknown-field":
					actions.push(...this.fixUnknownField(document, diagnostic));
					break;
				case "unknown-prop":
					actions.push(...this.fixUnknownProp(document, diagnostic));
					break;
				case "missing-prop":
					actions.push(...this.fixMissingProp(document, diagnostic));
					break;
			}
		}

		return actions;
	}

	private fixUnknownField(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		const fieldsMatch = diagnostic.message.match(/Available fields: (.+)$/);
		if (!fieldsMatch) return actions;

		const fields = fieldsMatch[1].split(", ");
		const didYouMean = diagnostic.message.match(/Did you mean: ([^?]+)\?/);
		const suggested = didYouMean ? didYouMean[1].split(", ") : [];

		const sorted = [
			...suggested,
			...fields.filter((f) => !suggested.includes(f)),
		];

		for (const field of sorted) {
			const isSuggested = suggested.includes(field);
			const label = isSuggested
				? `Did you mean "${field}"?`
				: `Replace with "${field}"`;
			const action = new vscode.CodeAction(
				label,
				vscode.CodeActionKind.QuickFix,
			);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(document.uri, diagnostic.range, field);
			action.diagnostics = [diagnostic];
			action.isPreferred = suggested.indexOf(field) === 0;
			actions.push(action);
		}

		return actions;
	}

	private fixUnknownProp(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		const propsMatch = diagnostic.message.match(/Defined props: (.+)$/);
		if (!propsMatch) return actions;

		const props = propsMatch[1].split(", ");
		const didYouMean = diagnostic.message.match(/Did you mean: ([^?]+)\?/);
		const suggested = didYouMean ? didYouMean[1].split(", ") : [];

		const sorted = [
			...suggested,
			...props.filter((p) => !suggested.includes(p)),
		];

		for (const prop of sorted) {
			const isSuggested = suggested.includes(prop);
			const label = isSuggested
				? `Did you mean "${prop}"?`
				: `Replace with "${prop}"`;
			const action = new vscode.CodeAction(
				label,
				vscode.CodeActionKind.QuickFix,
			);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(document.uri, diagnostic.range, prop);
			action.diagnostics = [diagnostic];
			action.isPreferred = suggested.indexOf(prop) === 0;
			actions.push(action);
		}

		return actions;
	}

	private fixMissingProp(
		document: vscode.TextDocument,
		diagnostic: vscode.Diagnostic,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];

		// Extract prop name and type from message: Missing required prop "to" (module) on <Link>.
		const match = diagnostic.message.match(
			/Missing required prop "(\w+)" \(([^)]+)\)/,
		);
		if (!match) return actions;

		const propName = match[1];
		const propType = match[2];

		// Find the end of the tag name to insert the prop after it
		// diagnostic.range covers the tag name
		const tagNameEnd = diagnostic.range.end;
		const insertPos = tagNameEnd;

		// Determine the value placeholder based on type
		let valuePlaceholder: string;
		if (propType === "string") {
			valuePlaceholder = `${propName}=""`;
		} else {
			valuePlaceholder = `${propName}={}`;
		}

		const action = new vscode.CodeAction(
			`Add missing prop "${propName}"`,
			vscode.CodeActionKind.QuickFix,
		);
		action.edit = new vscode.WorkspaceEdit();
		action.edit.insert(document.uri, insertPos, ` ${valuePlaceholder}`);
		action.diagnostics = [diagnostic];
		action.isPreferred = true;
		actions.push(action);

		return actions;
	}
}
