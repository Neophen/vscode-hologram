import * as vscode from 'vscode';
import {
  getCursorContext,
  findEnclosingModule,
  findStateDefinitions,
  findActionDefinitions,
  findFunctionDefinitions,
  findComponentLocations,
  findPageModule,
  resolveComponentName,
  escapeRegex,
} from './hologramResolver';
import { scanModuleMembers } from './eventCompletionProvider';
import { WorkspaceIndex } from './workspaceIndex';

export class HologramDefinitionProvider implements vscode.DefinitionProvider {
  private index: WorkspaceIndex;
  private outputChannel: vscode.OutputChannel;

  constructor(index: WorkspaceIndex, outputChannel: vscode.OutputChannel) {
    this.index = index;
    this.outputChannel = outputChannel;
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location | vscode.Location[] | undefined> {
    const line = document.lineAt(position.line).text;
    this.outputChannel.appendLine(`--- Go to Definition ---`);
    this.outputChannel.appendLine(`File: ${document.uri.fsPath}`);
    this.outputChannel.appendLine(`Line ${position.line}: "${line}"`);
    this.outputChannel.appendLine(`Char: ${position.character}`);

    const ctx = getCursorContext(document, position);
    if (!ctx) {
      this.outputChannel.appendLine(`No cursor context detected`);
      return undefined;
    }

    this.outputChannel.appendLine(`Context: ${ctx.kind} = "${ctx.name}"`);

    switch (ctx.kind) {
      case 'variable': {
        const moduleRange = findEnclosingModule(document, position);
        this.outputChannel.appendLine(`Module range: ${JSON.stringify(moduleRange)}`);
        if (!moduleRange) return undefined;
        const locs = findStateDefinitions(document, ctx.name, moduleRange);
        this.outputChannel.appendLine(`Found ${locs.length} variable definitions`);
        return locs.length > 0 ? locs : undefined;
      }

      case 'action': {
        const moduleRange = findEnclosingModule(document, position);
        this.outputChannel.appendLine(`Module range: ${JSON.stringify(moduleRange)}`);
        if (!moduleRange) return undefined;
        const locs = findActionDefinitions(document, ctx.name, moduleRange);
        this.outputChannel.appendLine(`Found ${locs.length} action definitions`);
        return locs.length > 0 ? locs : undefined;
      }

      case 'component': {
        // Try index first for fast lookup
        const fullName = resolveComponentName(ctx.name, document) ?? ctx.name;
        const mod = this.index.getModule(fullName) || this.index.getModuleByShortName(ctx.name);

        if (mod) {
          const config = vscode.workspace.getConfiguration('hologram');
          const target = config.get<string>('defaultJumpTarget', 'template');
          this.outputChannel.appendLine(`Default jump target: ${target}`);

          if (target === 'template' && mod.templateLine !== undefined) {
            const loc = new vscode.Location(mod.uri, new vscode.Position(mod.templateLine, 0));
            this.outputChannel.appendLine(`Jumping to template: ${mod.uri.fsPath}:${mod.templateLine}`);
            return loc;
          }
          if (target === 'init' && mod.initLine !== undefined) {
            const loc = new vscode.Location(mod.uri, new vscode.Position(mod.initLine, 0));
            this.outputChannel.appendLine(`Jumping to init: ${mod.uri.fsPath}:${mod.initLine}`);
            return loc;
          }
          // Fallback within index data
          if (mod.templateLine !== undefined) {
            return new vscode.Location(mod.uri, new vscode.Position(mod.templateLine, 0));
          }
          return new vscode.Location(mod.uri, new vscode.Position(mod.defmoduleLine, 0));
        }

        // Fallback to full scan (for modules not in index)
        const results = await findComponentLocations(ctx.name, document);
        this.outputChannel.appendLine(`Found ${results.length} component matches`);
        if (results.length === 0) return undefined;

        const config = vscode.workspace.getConfiguration('hologram');
        const target = config.get<string>('defaultJumpTarget', 'template');
        this.outputChannel.appendLine(`Default jump target: ${target}`);

        for (const locs of results) {
          const loc = locs[target as keyof typeof locs] ?? locs.template ?? locs.module;
          if (loc) {
            this.outputChannel.appendLine(`Jumping to: ${loc.uri.fsPath}:${loc.range.start.line}`);
            return loc;
          }
        }
        return undefined;
      }

      case 'function_call': {
        const moduleRange = findEnclosingModule(document, position);
        this.outputChannel.appendLine(`Module range: ${JSON.stringify(moduleRange)}`);
        if (!moduleRange) return undefined;
        const locs = findFunctionDefinitions(document, ctx.name, moduleRange);
        this.outputChannel.appendLine(`Found ${locs.length} function definitions`);
        return locs.length > 0 ? locs : undefined;
      }

      case 'page': {
        this.outputChannel.appendLine(`Looking for page module: ${ctx.name}`);

        // Try index first
        const fullName = resolveComponentName(ctx.name, document) ?? ctx.name;
        const mod = this.index.getModule(fullName) || this.index.getModuleByShortName(ctx.name);

        if (mod && mod.kind === 'page') {
          if (mod.templateLine !== undefined) {
            const loc = new vscode.Location(mod.uri, new vscode.Position(mod.templateLine, 0));
            this.outputChannel.appendLine(`Jumping to page template: ${mod.uri.fsPath}:${mod.templateLine}`);
            return loc;
          }
          const loc = new vscode.Location(mod.uri, new vscode.Position(mod.defmoduleLine, 0));
          this.outputChannel.appendLine(`Jumping to page module: ${mod.uri.fsPath}:${mod.defmoduleLine}`);
          return loc;
        }

        // Fallback to full scan
        const loc = await findPageModule(ctx.name, document);
        if (loc) {
          this.outputChannel.appendLine(`Jumping to page: ${loc.uri.fsPath}:${loc.range.start.line}`);
          return loc;
        }
        this.outputChannel.appendLine(`Page module not found`);
        return undefined;
      }

      case 'field_access': {
        this.outputChannel.appendLine(`Field access: @${ctx.varName}.${ctx.fieldName}`);
        const moduleRange = findEnclosingModule(document, position);
        if (!moduleRange) return undefined;

        const members = scanModuleMembers(document, moduleRange);

        const prop = members.props.find(p => p.name === ctx.varName);
        let moduleName: string | undefined;

        if (prop && prop.type !== 'any' && /^[A-Z]/.test(prop.type)) {
          moduleName = prop.type;
        }

        if (!moduleName) {
          this.outputChannel.appendLine(`No typed module found for @${ctx.varName}`);
          return undefined;
        }

        const resolvedFullName = resolveComponentName(moduleName, document) ?? moduleName;
        this.outputChannel.appendLine(`Resolving field "${ctx.fieldName}" in module "${resolvedFullName}"`);

        // Try index first to get the file URI
        const mod = this.index.getModule(resolvedFullName);
        if (mod) {
          const doc = await vscode.workspace.openTextDocument(mod.uri);
          const fileText = doc.getText();
          return this.findFieldInFile(doc, mod.uri, fileText, ctx.fieldName, resolvedFullName);
        }

        // Fallback to full scan
        const files = await vscode.workspace.findFiles(
          '**/*.{ex,exs}',
          '{**/deps/**,**/node_modules/**,**/_build/**}'
        );

        for (const fileUri of files) {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const fileText = doc.getText();

          const esc = escapeRegex(resolvedFullName);
          const defPattern = new RegExp(`^\\s*defmodule\\s+${esc}\\s+do`, 'm');
          if (!defPattern.test(fileText)) continue;

          const result = this.findFieldInFile(doc, fileUri, fileText, ctx.fieldName, resolvedFullName);
          if (result) return result;
          return undefined;
        }

        return undefined;
      }
    }
  }

  private findFieldInFile(
    doc: vscode.TextDocument,
    fileUri: vscode.Uri,
    fileText: string,
    fieldName: string,
    _moduleName: string
  ): vscode.Location | undefined {
    const escapedField = escapeRegex(fieldName);

    // Ash resource: attribute :field_name
    const attrPattern = new RegExp(`^\\s*attribute\\s+:${escapedField}\\b`, 'm');
    const attrMatch = attrPattern.exec(fileText);
    if (attrMatch) {
      const pos = doc.positionAt(attrMatch.index);
      this.outputChannel.appendLine(`Found attribute at ${fileUri.fsPath}:${pos.line}`);
      return new vscode.Location(fileUri, pos);
    }

    // Ash primary key
    const pkPattern = new RegExp(`^\\s*(?:uuid_v7_primary_key|uuid_primary_key|integer_primary_key)\\s*\\(\\s*:${escapedField}\\b`, 'm');
    const pkMatch = pkPattern.exec(fileText);
    if (pkMatch) {
      const pos = doc.positionAt(pkMatch.index);
      this.outputChannel.appendLine(`Found primary key at ${fileUri.fsPath}:${pos.line}`);
      return new vscode.Location(fileUri, pos);
    }

    // Ash timestamps
    if (fieldName === 'inserted_at' || fieldName === 'updated_at') {
      const tsMatch = /^\s*timestamps\(\)/m.exec(fileText);
      if (tsMatch) {
        const pos = doc.positionAt(tsMatch.index);
        this.outputChannel.appendLine(`Found timestamps at ${fileUri.fsPath}:${pos.line}`);
        return new vscode.Location(fileUri, pos);
      }
    }

    // Regular struct
    const structPattern = new RegExp(`defstruct\\s+.*:${escapedField}\\b`, 'm');
    const structMatch = structPattern.exec(fileText);
    if (structMatch) {
      const pos = doc.positionAt(structMatch.index);
      this.outputChannel.appendLine(`Found struct field at ${fileUri.fsPath}:${pos.line}`);
      return new vscode.Location(fileUri, pos);
    }

    this.outputChannel.appendLine(`Field "${fieldName}" not found in ${fileUri.fsPath}`);
    return undefined;
  }
}
