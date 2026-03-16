import * as vscode from 'vscode';
import {
  getCursorContext,
  findEnclosingModule,
  findStateDefinitions,
  findActionDefinitions,
  findFunctionDefinitions,
  findComponentLocations,
  findPageModule,
} from './hologramResolver';

const outputChannel = vscode.window.createOutputChannel('Hologram');

export class HologramDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location | vscode.Location[] | undefined> {
    const line = document.lineAt(position.line).text;
    outputChannel.appendLine(`--- Go to Definition ---`);
    outputChannel.appendLine(`File: ${document.uri.fsPath}`);
    outputChannel.appendLine(`Line ${position.line}: "${line}"`);
    outputChannel.appendLine(`Char: ${position.character}`);

    const ctx = getCursorContext(document, position);
    if (!ctx) {
      outputChannel.appendLine(`No cursor context detected`);
      return undefined;
    }

    outputChannel.appendLine(`Context: ${ctx.kind} = "${ctx.name}"`);

    switch (ctx.kind) {
      case 'variable': {
        const moduleRange = findEnclosingModule(document, position);
        outputChannel.appendLine(`Module range: ${JSON.stringify(moduleRange)}`);
        if (!moduleRange) return undefined;
        const locs = findStateDefinitions(document, ctx.name, moduleRange);
        outputChannel.appendLine(`Found ${locs.length} variable definitions`);
        return locs.length > 0 ? locs : undefined;
      }

      case 'action': {
        const moduleRange = findEnclosingModule(document, position);
        outputChannel.appendLine(`Module range: ${JSON.stringify(moduleRange)}`);
        if (!moduleRange) return undefined;
        const locs = findActionDefinitions(document, ctx.name, moduleRange);
        outputChannel.appendLine(`Found ${locs.length} action definitions`);
        return locs.length > 0 ? locs : undefined;
      }

      case 'component': {
        const results = await findComponentLocations(ctx.name, document);
        outputChannel.appendLine(`Found ${results.length} component matches`);
        if (results.length === 0) return undefined;

        const config = vscode.workspace.getConfiguration('hologram');
        const target = config.get<string>('defaultJumpTarget', 'template');
        outputChannel.appendLine(`Default jump target: ${target}`);

        for (const locs of results) {
          const loc = locs[target as keyof typeof locs] ?? locs.template ?? locs.module;
          if (loc) {
            outputChannel.appendLine(`Jumping to: ${loc.uri.fsPath}:${loc.range.start.line}`);
            return loc;
          }
        }
        return undefined;
      }

      case 'function_call': {
        const moduleRange = findEnclosingModule(document, position);
        outputChannel.appendLine(`Module range: ${JSON.stringify(moduleRange)}`);
        if (!moduleRange) return undefined;
        const locs = findFunctionDefinitions(document, ctx.name, moduleRange);
        outputChannel.appendLine(`Found ${locs.length} function definitions`);
        return locs.length > 0 ? locs : undefined;
      }

      case 'page': {
        outputChannel.appendLine(`Looking for page module: ${ctx.name}`);
        const loc = await findPageModule(ctx.name, document);
        if (loc) {
          outputChannel.appendLine(`Jumping to page: ${loc.uri.fsPath}:${loc.range.start.line}`);
          return loc;
        }
        outputChannel.appendLine(`Page module not found`);
        return undefined;
      }
    }
  }
}
