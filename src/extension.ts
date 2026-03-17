import * as vscode from "vscode";
import { ComponentCompletionProvider } from "./componentCompletionProvider";
import { ComponentPropsCodeActionProvider } from "./componentPropsCodeActionProvider";
import { ComponentPropsDiagnosticsProvider } from "./componentPropsDiagnosticsProvider";
import { HoloDevDefinitionProvider } from "./definitionProvider";
import { HoloDevEventCompletionProvider } from "./eventCompletionProvider";
import { FieldCodeActionProvider } from "./fieldCodeActionProvider";
import { FieldDiagnosticsProvider } from "./fieldDiagnosticsProvider";
import {
	PageCompletionProvider,
	PageDiagnosticsProvider,
} from "./pageCompletionProvider";
import { WorkspaceIndex } from "./workspaceIndex";

export async function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel("HoloDev");

	// Create and initialize the shared workspace index
	const index = new WorkspaceIndex();
	context.subscriptions.push(index);
	await index.initialize();

	const selector: vscode.DocumentSelector = [
		{ language: "hologram", scheme: "file" },
		{ language: "elixir", scheme: "file" },
	];

	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(
			selector,
			new HoloDevDefinitionProvider(index, outputChannel),
		),
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			selector,
			new HoloDevEventCompletionProvider(outputChannel, index),
			"$",
			"=",
			"@",
			".",
		),
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			selector,
			new PageCompletionProvider(outputChannel, index),
			"{",
		),
	);

	// Page diagnostics — squiggly lines for invalid page references
	const pageDiagnostics = new PageDiagnosticsProvider(outputChannel, index);
	context.subscriptions.push(pageDiagnostics);

	// Field diagnostics — squiggly lines for invalid field access on known types
	const fieldDiagnostics = new FieldDiagnosticsProvider(outputChannel, index);
	context.subscriptions.push(fieldDiagnostics);

	// Code actions — quick fix to replace unknown fields
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			selector,
			new FieldCodeActionProvider(),
			{
				providedCodeActionKinds:
					FieldCodeActionProvider.providedCodeActionKinds,
			},
		),
	);

	// Component props diagnostics — missing/unknown props
	const componentPropsDiagnostics = new ComponentPropsDiagnosticsProvider(
		outputChannel,
		index,
	);
	context.subscriptions.push(componentPropsDiagnostics);

	// Code actions — add available props to component tags
	const componentPropsActions = new ComponentPropsCodeActionProvider(index);
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			selector,
			componentPropsActions,
			{
				providedCodeActionKinds:
					ComponentPropsCodeActionProvider.providedCodeActionKinds,
			},
		),
	);

	// Component tag completion — autocomplete component names on `<`
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			selector,
			new ComponentCompletionProvider(index),
			"<",
		),
	);
}

export function deactivate() {}
