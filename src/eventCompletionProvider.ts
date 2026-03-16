import * as vscode from 'vscode';
import { findEnclosingModule } from './hologramResolver';

const HOLOGRAM_EVENTS = [
  { name: '$blur', description: 'Triggered when an element loses focus' },
  { name: '$change', description: 'Triggered when the value of an input element changes' },
  { name: '$click', description: 'Triggered when an element is clicked' },
  { name: '$focus', description: 'Triggered when an element receives focus' },
  { name: '$mouse_move', description: 'Triggered when the mouse cursor moves over an element' },
  { name: '$pointer_cancel', description: 'Triggered when a pointer event is cancelled' },
  { name: '$pointer_down', description: 'Triggered when a pointer is pressed down on an element' },
  { name: '$pointer_move', description: 'Triggered when a pointer moves while over an element' },
  { name: '$pointer_up', description: 'Triggered when a pointer is released from an element' },
  { name: '$select', description: 'Triggered when text is selected in an input or textarea' },
  { name: '$submit', description: 'Triggered when a form is submitted' },
  { name: '$transition_cancel', description: 'Triggered when a CSS transition is cancelled' },
  { name: '$transition_end', description: 'Triggered when a CSS transition has finished' },
  { name: '$transition_run', description: 'Triggered when a CSS transition is created' },
  { name: '$transition_start', description: 'Triggered when a CSS transition has started' },
];

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

interface PropInfo {
  name: string;
  type: string;
}

interface ModuleMembers {
  actions: ActionInfo[];
  commands: CommandInfo[];
  props: PropInfo[];
}

function scanModuleMembers(
  document: vscode.TextDocument,
  moduleRange: { start: number; end: number }
): ModuleMembers {
  const actions: ActionInfo[] = [];
  const commands: CommandInfo[] = [];
  const props: PropInfo[] = [];

  const text = document.getText();
  const lines = text.split('\n');

  for (let i = moduleRange.start; i <= moduleRange.end; i++) {
    const line = lines[i];
    if (!line) continue;

    // prop :name, :type
    const propMatch = line.match(/^\s*prop[\s(]+:(\w+)(?:\s*,\s*:(\w+))?/);
    if (propMatch) {
      props.push({ name: propMatch[1], type: propMatch[2] || 'any' });
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
  }

  return { actions, commands, props };
}

function extractFunctionBody(lines: string[], defLine: number, maxLine: number): string {
  const bodyLines: string[] = [];
  let depth = 0;
  let started = false;

  for (let i = defLine; i <= maxLine; i++) {
    const line = lines[i];
    if (!line) continue;

    // Count do/end depth (simple heuristic)
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

  // Check if the params variable is actually used in the body (beyond the def line)
  const bodyLines = body.split('\n').slice(1); // skip the def line
  const bodyText = bodyLines.join('\n');
  const pattern = new RegExp(`\\b${paramsVar}\\b`);
  return pattern.test(bodyText);
}

function extractParamKeys(body: string, paramsVar: string): string[] {
  const keys: string[] = [];

  // Match params.key_name access patterns
  const dotPattern = new RegExp(`\\b${paramsVar}\\.(\\w+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = dotPattern.exec(body)) !== null) {
    const key = match[1];
    if (key !== 'event' && !keys.includes(key)) {
      keys.push(key);
    }
  }

  // Match params[:key_name] or Map.get(params, :key_name) patterns
  const bracketPattern = new RegExp(`\\b${paramsVar}\\[\\s*:(\\w+)\\s*\\]`, 'g');
  while ((match = bracketPattern.exec(body)) !== null) {
    if (!keys.includes(match[1])) {
      keys.push(match[1]);
    }
  }

  return keys;
}

function isInsideHtmlTag(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  // Find the last < or > before cursor
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

  // We're inside a tag if < appears after the last >
  return lastOpenTag > lastCloseTag;
}

function isInsideHoloSigil(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  // Find the last ~HOLO opening
  const sigilStart = text.lastIndexOf('~HOLO');
  if (sigilStart === -1) return false;

  // Check that the sigil delimiter hasn't been closed
  const afterSigil = text.substring(sigilStart + 5);
  if (afterSigil.startsWith('"""')) {
    // Heredoc - check we haven't hit the closing """
    const rest = afterSigil.substring(3);
    // Count triple-quote occurrences — odd means still open
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
): 'event_type' | 'event_value' | null {
  const line = document.lineAt(position.line).text;
  const textBefore = line.substring(0, position.character);

  // Check if we're typing a $ at the start of an attribute name
  // e.g., "<button $" or "<div $cli"
  if (/\$\w*$/.test(textBefore) && isInsideHtmlTag(document, position)) {
    return 'event_type';
  }

  // Check if we just typed = after an event attribute
  // e.g., "$click=" or "$change="
  if (/\$\w+=["'{]?$/.test(textBefore) && isInsideHtmlTag(document, position)) {
    return 'event_value';
  }

  return null;
}

export class HologramEventCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.CompletionItem[] | undefined {
    const isElixir = document.languageId === 'elixir';
    const isHologram = document.languageId === 'hologram';

    if (isElixir && !isInsideHoloSigil(document, position)) {
      return undefined;
    }

    if (!isElixir && !isHologram) {
      return undefined;
    }

    const ctx = getCompletionContext(document, position);
    if (!ctx) return undefined;

    if (ctx === 'event_type') {
      return this.getEventTypeCompletions(document, position);
    }

    if (ctx === 'event_value') {
      return this.getEventValueCompletions(document, position);
    }

    return undefined;
  }

  private getEventTypeCompletions(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const textBefore = line.substring(0, position.character);

    // Find the $ start position to set the replacement range
    const dollarMatch = textBefore.match(/\$(\w*)$/);
    if (!dollarMatch) return [];

    const dollarStart = position.character - dollarMatch[0].length;
    const range = new vscode.Range(
      new vscode.Position(position.line, dollarStart),
      position
    );

    return HOLOGRAM_EVENTS.map((event, index) => {
      const item = new vscode.CompletionItem(event.name, vscode.CompletionItemKind.Event);
      item.detail = event.description;
      item.sortText = String(index).padStart(2, '0');
      item.range = range;
      // Insert just the event name, user will then type = to get value completions
      item.insertText = new vscode.SnippetString(`${event.name}=`);
      item.command = {
        command: 'editor.action.triggerSuggest',
        title: 'Trigger value completions',
      };
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

    // Determine what's already been typed after =
    const afterEquals = textBefore.match(/\$\w+=(.*)$/);
    const typed = afterEquals ? afterEquals[1] : '';

    // Calculate replacement range (from after the = sign)
    const equalsPos = textBefore.lastIndexOf('=');
    const replaceStart = equalsPos + 1;
    const range = new vscode.Range(
      new vscode.Position(position.line, replaceStart),
      position
    );

    // Actions first
    for (const action of members.actions) {
      if (action.usesParams && action.params.length > 0) {
        // Expression Shorthand Syntax with discovered params
        const paramSnippets = action.params
          .map((p, i) => `${p}: \${${i + 1}:value}`)
          .join(', ');

        const item = new vscode.CompletionItem(
          `:${action.name}`,
          vscode.CompletionItemKind.Function
        );
        item.detail = `Action (with params: ${action.params.join(', ')})`;
        item.documentation = new vscode.MarkdownString(
          `Expression Shorthand Syntax\n\n\`{:${action.name}, ${action.params.map(p => `${p}: value`).join(', ')}}\``
        );
        item.sortText = String(sortIndex++).padStart(3, '0');
        item.range = range;
        item.insertText = new vscode.SnippetString(
          `{:${action.name}, ${paramSnippets}}`
        );
        // Filter should work whether they typed {, :, or the name
        item.filterText = `${typed}{:${action.name}`;
        items.push(item);
      } else {
        // Text Syntax — no params
        const item = new vscode.CompletionItem(
          `:${action.name}`,
          vscode.CompletionItemKind.Function
        );
        item.detail = 'Action (text syntax)';
        item.documentation = new vscode.MarkdownString(
          `Text Syntax\n\n\`"${action.name}"\``
        );
        item.sortText = String(sortIndex++).padStart(3, '0');
        item.range = range;
        item.insertText = new vscode.SnippetString(`"${action.name}"`);
        item.filterText = `${typed}"${action.name}`;
        items.push(item);
      }

      // Also offer longhand for all actions
      const longhandItem = new vscode.CompletionItem(
        `:${action.name} (longhand)`,
        vscode.CompletionItemKind.Function
      );
      longhandItem.detail = 'Action (longhand syntax)';
      longhandItem.documentation = new vscode.MarkdownString(
        `Expression Longhand Syntax\n\n\`{action: :${action.name}, target: "component", params: %{key: value}}\``
      );
      longhandItem.sortText = String(sortIndex++).padStart(3, '0');
      longhandItem.range = range;
      longhandItem.insertText = new vscode.SnippetString(
        `{action: :${action.name}\${1:, target: "\${2:page}"}\${3:, params: %\\{\${4:key}: \${5:value}\\}}}`
      );
      longhandItem.filterText = `${typed}{action:${action.name}`;
      items.push(longhandItem);
    }

    // Commands — always longhand
    for (const command of members.commands) {
      const item = new vscode.CompletionItem(
        `:${command.name}`,
        vscode.CompletionItemKind.Method
      );
      item.detail = 'Command (longhand syntax)';
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
          `{command: :${command.name}, params: %\\{${paramSnippets}\\}}`
        );
      } else {
        item.insertText = new vscode.SnippetString(
          `{command: :${command.name}\${1:, params: %\\{\${2:key}: \${3:value}\\}}}`
        );
      }
      item.filterText = `${typed}{command:${command.name}`;
      items.push(item);
    }

    // Props as shorthand action values
    for (const prop of members.props) {
      const item = new vscode.CompletionItem(
        `@${prop.name}`,
        vscode.CompletionItemKind.Property
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
}
