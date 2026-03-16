import * as vscode from 'vscode';
import { findEnclosingModule, resolveComponentName } from './hologramResolver';
import { WorkspaceIndex } from './workspaceIndex';

interface EventType {
  name: string;
  description?: string;
}

const DEFAULT_EVENT_TYPES: EventType[] = [
  { name: '$click', description: 'Triggered when an element is clicked' },
  { name: '$change', description: 'Triggered when the value of an input element changes' },
  { name: '$submit', description: 'Triggered when a form is submitted' },
  { name: '$select', description: 'Triggered when text is selected in an input or textarea' },
  { name: '$blur', description: 'Triggered when an element loses focus' },
  { name: '$focus', description: 'Triggered when an element receives focus' },
  { name: '$mouse_move', description: 'Triggered when the mouse cursor moves over an element' },
  { name: '$pointer_down', description: 'Triggered when a pointer is pressed down on an element' },
  { name: '$pointer_up', description: 'Triggered when a pointer is released from an element' },
  { name: '$pointer_move', description: 'Triggered when a pointer moves while over an element' },
  { name: '$pointer_cancel', description: 'Triggered when a pointer event is cancelled' },
  { name: '$transition_end', description: 'Triggered when a CSS transition has finished' },
  { name: '$transition_start', description: 'Triggered when a CSS transition has started' },
  { name: '$transition_run', description: 'Triggered when a CSS transition is created' },
  { name: '$transition_cancel', description: 'Triggered when a CSS transition is cancelled' },
];

function getEventTypes(): EventType[] {
  const config = vscode.workspace.getConfiguration('hologram');
  return config.get<EventType[]>('eventTypes', DEFAULT_EVENT_TYPES);
}

interface ActionInfo {
  name: string;
  usesParams: boolean;
  params: string[];
}

interface CommandInfo {
  name: string;
  usesParams: boolean;
  params: string[];
}

export interface PropInfo {
  name: string;
  type: string;
}

export interface StateInfo {
  name: string;
  source: 'put_state' | 'init';
}

export interface ModuleMembers {
  actions: ActionInfo[];
  commands: CommandInfo[];
  props: PropInfo[];
  stateKeys: StateInfo[];
}

export function scanModuleMembers(
  document: vscode.TextDocument,
  moduleRange: { start: number; end: number }
): ModuleMembers {
  const actions: ActionInfo[] = [];
  const commands: CommandInfo[] = [];
  const props: PropInfo[] = [];
  const stateKeysSet = new Map<string, StateInfo>();

  const text = document.getText();
  const lines = text.split('\n');

  for (let i = moduleRange.start; i <= moduleRange.end; i++) {
    const line = lines[i];
    if (!line) continue;

    // prop :name, :type or prop(:name, ModuleName)
    const propMatch = line.match(/^\s*prop[\s(]+:(\w+)(?:\s*,\s*:?(\w[\w.]*))?/);
    if (propMatch) {
      const propType = propMatch[2] || 'any';
      props.push({ name: propMatch[1], type: propType });
      continue;
    }

    // def action(:name, params, component) do
    const actionMatch = line.match(/^\s*def\s+action\s*\(\s*:(\w+)\s*,\s*(\w+)/);
    if (actionMatch) {
      const actionName = actionMatch[1];
      const paramsVar = actionMatch[2];
      const body = extractFunctionBody(lines, i, moduleRange.end);
      const usesParams = checkUsesParams(body, paramsVar);
      const params = usesParams ? extractParamKeys(body, paramsVar) : [];
      actions.push({ name: actionName, usesParams, params });
      continue;
    }

    // def command(:name, params, server) do
    const commandMatch = line.match(/^\s*def\s+command\s*\(\s*:(\w+)\s*,\s*(\w+)/);
    if (commandMatch) {
      const commandName = commandMatch[1];
      const paramsVar = commandMatch[2];
      const body = extractFunctionBody(lines, i, moduleRange.end);
      const usesParams = checkUsesParams(body, paramsVar);
      const params = usesParams ? extractParamKeys(body, paramsVar) : [];
      commands.push({ name: commandName, usesParams, params });
      continue;
    }

    // put_state(component, :key, value) or |> put_state(:key, value)
    const putStateAtom = line.match(/put_state\s*\([^,]*,\s*:(\w+)/);
    if (putStateAtom && !stateKeysSet.has(putStateAtom[1])) {
      stateKeysSet.set(putStateAtom[1], { name: putStateAtom[1], source: 'put_state' });
    }
    const putStatePiped = line.match(/put_state\s*\(\s*:(\w+)/);
    if (putStatePiped && !putStateAtom && !stateKeysSet.has(putStatePiped[1])) {
      stateKeysSet.set(putStatePiped[1], { name: putStatePiped[1], source: 'put_state' });
    }

    // put_state(component, key: value, key2: value2) — keyword list (flat state)
    const putStateKw = /put_state\s*\([^,]+,\s*((?:\w+:\s*[^,)]+,?\s*)+)/;
    const kwMatch = line.match(putStateKw);
    if (kwMatch && !putStateAtom) {
      const kwPairs = kwMatch[1].matchAll(/(\w+):\s*/g);
      for (const kw of kwPairs) {
        if (!stateKeysSet.has(kw[1])) {
          stateKeysSet.set(kw[1], { name: kw[1], source: 'put_state' });
        }
      }
    }

    // put_state(component, %{key: value}) — map of flat state keys
    const putStateMap = line.match(/put_state\s*\([^,]+,\s*%\{([^}]+)\}/);
    if (putStateMap) {
      const mapPairs = putStateMap[1].matchAll(/(\w+):\s*/g);
      for (const mp of mapPairs) {
        if (!stateKeysSet.has(mp[1])) {
          stateKeysSet.set(mp[1], { name: mp[1], source: 'put_state' });
        }
      }
    }
  }

  return { actions, commands, props, stateKeys: Array.from(stateKeysSet.values()) };
}

function extractFunctionBody(lines: string[], defLine: number, maxLine: number): string {
  const bodyLines: string[] = [];
  let depth = 0;
  let started = false;

  for (let i = defLine; i <= maxLine; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/\bdo\b/.test(line)) {
      depth++;
      started = true;
    }
    if (started) {
      bodyLines.push(line);
    }
    if (/^\s*end\b/.test(line) && started) {
      depth--;
      if (depth <= 0) break;
    }
  }

  return bodyLines.join('\n');
}

function checkUsesParams(body: string, paramsVar: string): boolean {
  if (paramsVar === '_params' || paramsVar === '_') return false;

  const bodyLines = body.split('\n').slice(1);
  const bodyText = bodyLines.join('\n');
  const pattern = new RegExp(`\\b${paramsVar}\\b`);
  return pattern.test(bodyText);
}

function extractParamKeys(body: string, paramsVar: string): string[] {
  const keys: string[] = [];

  const dotPattern = new RegExp(`\\b${paramsVar}\\.(\\w+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = dotPattern.exec(body)) !== null) {
    const key = match[1];
    if (key !== 'event' && !keys.includes(key)) {
      keys.push(key);
    }
  }

  const bracketPattern = new RegExp(`\\b${paramsVar}\\[\\s*:(\\w+)\\s*\\]`, 'g');
  while ((match = bracketPattern.exec(body)) !== null) {
    if (!keys.includes(match[1])) {
      keys.push(match[1]);
    }
  }

  return keys;
}

export async function resolveModuleFields(
  moduleName: string,
  document: vscode.TextDocument
): Promise<string[]> {
  const text = document.getText();
  let fullName = moduleName;

  const aliasPattern = new RegExp(`^\\s*alias\\s+(\\S+\\.${moduleName})\\s*$`, 'm');
  const aliasMatch = aliasPattern.exec(text);
  if (aliasMatch) {
    fullName = aliasMatch[1];
  }

  const aliasAsPattern = new RegExp(`^\\s*alias\\s+(\\S+),\\s*as:\\s*${moduleName}\\s*$`, 'm');
  const aliasAsMatch = aliasAsPattern.exec(text);
  if (aliasAsMatch) {
    fullName = aliasAsMatch[1];
  }

  const groupPattern = /^\s*alias\s+(\S+)\.\{([^}]+)\}/gm;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupPattern.exec(text)) !== null) {
    const names = groupMatch[2].split(',').map(n => n.trim());
    if (names.includes(moduleName)) {
      fullName = `${groupMatch[1]}.${moduleName}`;
      break;
    }
  }

  const files = await vscode.workspace.findFiles(
    '**/*.{ex,exs}',
    '{**/deps/**,**/node_modules/**,**/_build/**}'
  );

  for (const fileUri of files) {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const fileText = doc.getText();

    const defPattern = new RegExp(`^\\s*defmodule\\s+${fullName.replace(/\./g, '\\.')}\\s+do`, 'm');
    if (!defPattern.test(fileText)) continue;

    const fields: string[] = [];

    const attrPattern = /^\s*attribute\s+:(\w+)/gm;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(fileText)) !== null) {
      fields.push(attrMatch[1]);
    }

    const pkPattern = /^\s*(?:uuid_v7_primary_key|uuid_primary_key|integer_primary_key)\s*\(\s*:(\w+)/gm;
    let pkMatch: RegExpExecArray | null;
    while ((pkMatch = pkPattern.exec(fileText)) !== null) {
      fields.push(pkMatch[1]);
    }

    if (/^\s*timestamps\(\)/m.test(fileText)) {
      fields.push('inserted_at', 'updated_at');
    }

    if (fields.length > 0) return fields;
  }

  return [];
}

function isInsideHtmlTag(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  let lastOpenTag = -1;
  let lastCloseTag = -1;

  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '<' && lastOpenTag === -1) {
      lastOpenTag = i;
    }
    if (text[i] === '>' && lastCloseTag === -1) {
      lastCloseTag = i;
    }
    if (lastOpenTag !== -1 && lastCloseTag !== -1) break;
  }

  return lastOpenTag > lastCloseTag;
}

function isInsideHoloSigil(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  const sigilStart = text.lastIndexOf('~HOLO');
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

function getCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): 'event_type' | 'event_value' | 'state_variable' | 'field_access' | null {
  const line = document.lineAt(position.line).text;
  const textBefore = line.substring(0, position.character);

  if (/\$\w*$/.test(textBefore) && isInsideHtmlTag(document, position)) {
    return 'event_type';
  }

  if (/\$\w+=["'{]?$/.test(textBefore) && isInsideHtmlTag(document, position)) {
    return 'event_value';
  }

  if (/@(\w+)\.(\w*)$/.test(textBefore)) {
    return 'field_access';
  }

  if (/@\w*$/.test(textBefore)) {
    return 'state_variable';
  }

  return null;
}

export class HologramEventCompletionProvider implements vscode.CompletionItemProvider {
  private outputChannel: vscode.OutputChannel;
  private index: WorkspaceIndex;

  constructor(outputChannel: vscode.OutputChannel, index: WorkspaceIndex) {
    this.outputChannel = outputChannel;
    this.index = index;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);
    this.outputChannel.appendLine(`--- Event Completion ---`);
    this.outputChannel.appendLine(`Language: ${document.languageId}, Trigger: "${context.triggerCharacter || 'none'}"`);
    this.outputChannel.appendLine(`Line ${position.line}: "${line}"`);
    this.outputChannel.appendLine(`Text before cursor: "${textBefore}"`);

    const isElixir = document.languageId === 'elixir';
    const isHologram = document.languageId === 'hologram';

    if (isElixir && !isInsideHoloSigil(document, position)) {
      this.outputChannel.appendLine(`Skipped: not inside ~HOLO sigil`);
      return undefined;
    }

    if (!isElixir && !isHologram) {
      this.outputChannel.appendLine(`Skipped: language not elixir or hologram`);
      return undefined;
    }

    const insideTag = isInsideHtmlTag(document, position);
    this.outputChannel.appendLine(`Inside HTML tag: ${insideTag}`);

    const ctx = getCompletionContext(document, position);
    this.outputChannel.appendLine(`Completion context: ${ctx || 'none'}`);
    if (!ctx) return undefined;

    if (ctx === 'event_type') {
      const items = this.getEventTypeCompletions(document, position);
      this.outputChannel.appendLine(`Returning ${items.length} event type completions`);
      return items;
    }

    if (ctx === 'event_value') {
      const items = this.getEventValueCompletions(document, position);
      this.outputChannel.appendLine(`Returning ${items.length} event value completions`);
      return items;
    }

    if (ctx === 'state_variable') {
      const items = this.getStateVariableCompletions(document, position);
      this.outputChannel.appendLine(`Returning ${items.length} state variable completions`);
      return items;
    }

    if (ctx === 'field_access') {
      const items = await this.getFieldAccessCompletions(document, position);
      this.outputChannel.appendLine(`Returning ${items.length} field access completions`);
      return items;
    }

    return undefined;
  }

  private getEventTypeCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const dollarMatch = textBefore.match(/\$(\w*)$/);
    if (!dollarMatch) return [];

    const dollarStart = position.character - dollarMatch[0].length;

    const events = getEventTypes();

    const afterDollarRange = new vscode.Range(
      new vscode.Position(position.line, dollarStart + 1),
      position
    );

    return events.map((event, index) => {
      const nameWithoutDollar = event.name.replace(/^\$/, '');
      const item = new vscode.CompletionItem(event.name, vscode.CompletionItemKind.Event);
      item.detail = event.description || '';
      item.sortText = String(index).padStart(2, '0');
      item.filterText = nameWithoutDollar;
      item.range = {
        inserting: afterDollarRange,
        replacing: afterDollarRange,
      };
      item.insertText = nameWithoutDollar;
      this.outputChannel.appendLine(`  Item: label="${item.label}" insertText="${item.insertText}" filterText="${item.filterText}" range=[${dollarStart + 1},${position.character}] kind=${item.kind}`);
      return item;
    });
  }

  private getEventValueCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const moduleRange = findEnclosingModule(document, position);
    if (!moduleRange) return [];

    const members = scanModuleMembers(document, moduleRange);
    const items: vscode.CompletionItem[] = [];
    let sortIndex = 0;

    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const afterEquals = textBefore.match(/\$\w+=(.*)$/);
    const typed = afterEquals ? afterEquals[1] : '';

    const equalsPos = textBefore.lastIndexOf('=');
    const replaceStart = equalsPos + 1;
    const range = new vscode.Range(
      new vscode.Position(position.line, replaceStart),
      position
    );

    for (const action of members.actions) {
      if (action.usesParams && action.params.length > 0) {
        const paramSnippets = action.params
          .map((p, i) => `${p}: \${${i + 1}:value}`)
          .join(', ');

        const item = new vscode.CompletionItem(
          `:${action.name}`,
          vscode.CompletionItemKind.Function
        );
        item.detail = `Action (${action.params.join(', ')})`;
        item.documentation = new vscode.MarkdownString(
          `Expression Shorthand Syntax\n\n\`{:${action.name}, ${action.params.map(p => `${p}: value`).join(', ')}}\``
        );
        item.sortText = String(sortIndex++).padStart(3, '0');
        item.range = range;
        item.insertText = new vscode.SnippetString(
          `{:${action.name}, ${paramSnippets}}`
        );
        item.filterText = `${typed}{:${action.name}`;
        items.push(item);
      } else {
        const item = new vscode.CompletionItem(
          `:${action.name}`,
          vscode.CompletionItemKind.Function
        );
        item.detail = 'Action';
        item.documentation = new vscode.MarkdownString(
          `Text Syntax\n\n\`"${action.name}"\``
        );
        item.sortText = String(sortIndex++).padStart(3, '0');
        item.range = range;
        item.insertText = new vscode.SnippetString(`"${action.name}"`);
        item.filterText = `${typed}"${action.name}`;
        items.push(item);
      }

      const longhandItem = new vscode.CompletionItem(
        `:${action.name} (longhand)`,
        vscode.CompletionItemKind.Function
      );
      longhandItem.detail = 'Action (longhand)';
      longhandItem.documentation = new vscode.MarkdownString(
        `Expression Longhand Syntax\n\n\`{action: :${action.name}, target: "component", params: %{key: value}}\``
      );
      longhandItem.sortText = String(sortIndex++).padStart(3, '0');
      longhandItem.range = range;
      longhandItem.insertText = new vscode.SnippetString(
        `{action: :${action.name}\${1:, target: "\${2:page}"}\${3:, params: %{\${4:key}: \${5:value}}}}`
      );
      longhandItem.filterText = `${typed}{action:${action.name}`;
      items.push(longhandItem);
    }

    for (const command of members.commands) {
      const item = new vscode.CompletionItem(
        `:${command.name}`,
        vscode.CompletionItemKind.Event
      );
      item.detail = 'Command';
      item.documentation = new vscode.MarkdownString(
        `Command Longhand Syntax\n\n\`{command: :${command.name}, params: %{key: value}}\``
      );
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.range = range;

      if (command.usesParams && command.params.length > 0) {
        const paramSnippets = command.params
          .map((p, i) => `${p}: \${${i + 1}:value}`)
          .join(', ');
        item.insertText = new vscode.SnippetString(
          `{command: :${command.name}, params: %{${paramSnippets}}}`
        );
      } else {
        item.insertText = new vscode.SnippetString(
          `{command: :${command.name}\${1:, params: %{\${2:key}: \${3:value}}}}`
        );
      }
      item.filterText = `${typed}{command:${command.name}`;
      items.push(item);
    }

    for (const prop of members.props) {
      const item = new vscode.CompletionItem(
        `@${prop.name}`,
        vscode.CompletionItemKind.Field
      );
      item.detail = `Prop (${prop.type})`;
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.range = range;
      item.insertText = new vscode.SnippetString(`{@${prop.name}}`);
      item.filterText = `${typed}{@${prop.name}`;
      items.push(item);
    }

    return items;
  }

  private getStateVariableCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const moduleRange = findEnclosingModule(document, position);
    if (!moduleRange) return [];

    const members = scanModuleMembers(document, moduleRange);
    const items: vscode.CompletionItem[] = [];
    let sortIndex = 0;

    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const atMatch = textBefore.match(/@(\w*)$/);
    if (!atMatch) return [];

    const atStart = position.character - atMatch[0].length;
    const afterAtRange = new vscode.Range(
      new vscode.Position(position.line, atStart + 1),
      position
    );

    for (const prop of members.props) {
      const item = new vscode.CompletionItem(
        `@${prop.name}`,
        vscode.CompletionItemKind.Property
      );
      item.detail = `Prop (${prop.type})`;
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.filterText = prop.name;
      item.range = {
        inserting: afterAtRange,
        replacing: afterAtRange,
      };
      item.insertText = prop.name;
      items.push(item);
    }

    const seenNames = new Set(members.props.map(p => p.name));
    for (const state of members.stateKeys) {
      if (seenNames.has(state.name)) continue;
      seenNames.add(state.name);

      const item = new vscode.CompletionItem(
        `@${state.name}`,
        vscode.CompletionItemKind.Variable
      );
      item.detail = 'State';
      item.sortText = String(sortIndex++).padStart(3, '0');
      item.filterText = state.name;
      item.range = {
        inserting: afterAtRange,
        replacing: afterAtRange,
      };
      item.insertText = state.name;
      items.push(item);
    }

    return items;
  }

  private async getFieldAccessCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const moduleRange = findEnclosingModule(document, position);
    if (!moduleRange) return [];

    const members = scanModuleMembers(document, moduleRange);

    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    const fieldMatch = textBefore.match(/@(\w+)\.(\w*)$/);
    if (!fieldMatch) return [];

    const varName = fieldMatch[1];
    const partialField = fieldMatch[2];
    this.outputChannel.appendLine(`Field access: @${varName}.${partialField}`);

    let fields: string[] = [];
    let source = '';

    const prop = members.props.find(p => p.name === varName);
    if (prop) {
      source = `Prop (${prop.type})`;
      if (prop.type !== 'any' && /^[A-Z]/.test(prop.type)) {
        const fullName = resolveComponentName(prop.type, document) ?? prop.type;
        fields = this.index.getModuleFields(fullName);
        if (fields.length === 0) {
          fields = await resolveModuleFields(prop.type, document);
        }
      }
    }

    if (fields.length === 0) {
      const templateFields = this.scanTemplateFieldUsage(document, moduleRange, varName);
      fields = templateFields;
      source = source || 'Inferred';
    }

    this.outputChannel.appendLine(`Found ${fields.length} fields for @${varName}: ${fields.join(', ')}`);

    if (fields.length === 0) return [];

    const dotPos = position.character - partialField.length;
    const afterDotRange = new vscode.Range(
      new vscode.Position(position.line, dotPos),
      position
    );

    return fields.map((field, index) => {
      const item = new vscode.CompletionItem(
        field,
        vscode.CompletionItemKind.Field
      );
      item.detail = source;
      item.sortText = String(index).padStart(3, '0');
      item.filterText = field;
      item.range = {
        inserting: afterDotRange,
        replacing: afterDotRange,
      };
      item.insertText = field;
      return item;
    });
  }

  private scanTemplateFieldUsage(
    document: vscode.TextDocument,
    moduleRange: { start: number; end: number },
    varName: string
  ): string[] {
    const fields: string[] = [];
    const pattern = new RegExp(`@${varName}\\.(\\w+)`, 'g');

    for (let i = moduleRange.start; i <= moduleRange.end; i++) {
      const line = document.lineAt(i).text;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        if (!fields.includes(match[1])) {
          fields.push(match[1]);
        }
      }
    }

    return fields;
  }
}
