import * as vscode from 'vscode';
import { HologramDefinitionProvider } from './definitionProvider';
import { HologramEventCompletionProvider } from './eventCompletionProvider';

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [
    { language: 'hologram', scheme: 'file' },
    { language: 'elixir', scheme: 'file' }
  ];

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      selector,
      new HologramDefinitionProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new HologramEventCompletionProvider(),
      '$', '='
    )
  );
}

export function deactivate() {}
