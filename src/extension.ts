import * as vscode from 'vscode';
import { HologramDefinitionProvider } from './definitionProvider';

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
}

export function deactivate() {}
