import * as vscode from 'vscode';

export interface ComponentLocations {
  module?: vscode.Location;
  template?: vscode.Location;
  init?: vscode.Location;
}

export type CursorContext =
  | { kind: 'variable'; name: string }
  | { kind: 'action'; name: string }
  | { kind: 'component'; name: string }
  | { kind: 'function_call'; name: string }
  | { kind: 'page'; name: string }
  | { kind: 'field_access'; varName: string; fieldName: string; name: string };

export function getCursorContext(
  document: vscode.TextDocument,
  position: vscode.Position
): CursorContext | undefined {
  const line = document.lineAt(position.line).text;
  const char = position.character;

  // 0. @variable.field — field access on a state/prop
  const fieldAccessPattern = /@(\w+)\.(\w+)/g;
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = fieldAccessPattern.exec(line)) !== null) {
    // Check if cursor is on the field part (after the dot)
    const dotPos = fieldMatch.index + 1 + fieldMatch[1].length; // after @varName
    const fieldStart = dotPos + 1; // after the .
    const fieldEnd = fieldStart + fieldMatch[2].length;
    if (char >= fieldStart && char <= fieldEnd) {
      return { kind: 'field_access', varName: fieldMatch[1], fieldName: fieldMatch[2], name: fieldMatch[2] };
    }
  }

  // 1. @variable
  const varResult = matchAtPosition(line, char, /@(\w+)/g);
  if (varResult) {
    return { kind: 'variable', name: varResult };
  }

  // 2. Any $ attribute — match on the value text itself, not the whole attribute
  //    $click="increment" → clicking anywhere on "increment" triggers
  //    $change="toggle_done" → clicking anywhere on "toggle_done" triggers
  const dollarStringValueResult = matchAtPosition(line, char, /\$\w+="(\w+)"/g, 1, true);
  if (dollarStringValueResult) {
    return { kind: 'action', name: dollarStringValueResult };
  }

  // $ attribute expression: $click={:name, ...}
  //    match on :name part specifically
  const dollarExprValueResult = matchAtPosition(line, char, /\$\w+=\{(?:action:\s*)?(:(\w+))/g, 2, false, 1);
  if (dollarExprValueResult) {
    return { kind: 'action', name: dollarExprValueResult };
  }

  // 3. layout MyApp.Layouts.Main — jump to the layout module
  const layoutPattern = /^\s*layout\s+([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/g;
  let layoutMatch: RegExpExecArray | null;
  while ((layoutMatch = layoutPattern.exec(line)) !== null) {
    const nameStart = layoutMatch[0].indexOf(layoutMatch[1]) + layoutMatch.index;
    const nameEnd = nameStart + layoutMatch[1].length;
    if (char >= nameStart && char <= nameEnd) {
      return { kind: 'component', name: layoutMatch[1] };
    }
  }

  // 4. Link to={PageModule} or to={PageModule, key: val}
  //    Matches: to={Blog.PostPage} or to={Blog.PostPage, id: @post.id}
  const linkToPattern = /to=\{([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/g;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkToPattern.exec(line)) !== null) {
    const nameStart = linkMatch.index + 4; // skip "to={"
    const nameEnd = nameStart + linkMatch[1].length;
    if (char >= nameStart && char <= nameEnd) {
      return { kind: 'page', name: linkMatch[1] };
    }
  }

  // 4. Component tag: <ComponentName or </ComponentName
  const compPattern = /<\/?([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)/g;
  let compMatch: RegExpExecArray | null;
  while ((compMatch = compPattern.exec(line)) !== null) {
    const prefix = compMatch[0].startsWith('</') ? 2 : 1;
    const nameStart = compMatch.index + prefix;
    const nameEnd = nameStart + compMatch[1].length;
    if (char >= nameStart && char <= nameEnd) {
      return { kind: 'component', name: compMatch[1] };
    }
  }

  // 4. Function call in expression: {func_name(...)}, class={func_name(...)}
  const funcResult = matchAtPosition(line, char, /\b([a-z_]\w*)\s*\(/g);
  if (funcResult && !isElixirBuiltin(funcResult)) {
    return { kind: 'function_call', name: funcResult };
  }

  return undefined;
}

/**
 * Match a regex at a cursor position.
 * @param useValueRange - if true, match on the capture group's range instead of the full match range
 * @param rangeGroupIndex - which capture group to use for range checking (default: groupIndex)
 */
function matchAtPosition(
  line: string,
  char: number,
  pattern: RegExp,
  groupIndex = 1,
  useValueRange = false,
  rangeGroupIndex?: number
): string | undefined {
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    let hitStart: number;
    let hitEnd: number;

    if (useValueRange) {
      // Find the position of the captured group within the full match
      const valueStr = match[groupIndex];
      const valueOffset = match[0].lastIndexOf(valueStr);
      hitStart = match.index + valueOffset;
      hitEnd = hitStart + valueStr.length;
    } else if (rangeGroupIndex !== undefined) {
      // Use a specific group for range checking
      const rangeStr = match[rangeGroupIndex];
      const rangeOffset = match[0].indexOf(rangeStr);
      hitStart = match.index + rangeOffset;
      hitEnd = hitStart + rangeStr.length;
    } else {
      hitStart = match.index;
      hitEnd = hitStart + match[0].length;
    }

    if (char >= hitStart && char <= hitEnd) {
      return match[groupIndex];
    }
  }
  return undefined;
}

function isElixirBuiltin(name: string): boolean {
  const builtins = new Set([
    'length', 'put_state', 'put_command', 'put_action', 'put_page',
    'put_context', 'put_session', 'put_cookie', 'if', 'unless',
    'for', 'case', 'cond', 'with', 'fn', 'raise', 'throw',
    'try', 'receive', 'send', 'spawn', 'import', 'require',
    'use', 'alias', 'defmodule', 'def', 'defp', 'is_nil',
    'is_map', 'is_list', 'is_atom', 'is_binary', 'is_integer',
    'is_float', 'is_boolean', 'is_tuple', 'hd', 'tl', 'elem',
    'map_size', 'tuple_size', 'byte_size', 'bit_size', 'rem',
    'div', 'abs', 'round', 'trunc', 'max', 'min', 'not',
    'inspect', 'to_string'
  ]);
  return builtins.has(name);
}

export function findEnclosingModule(
  document: vscode.TextDocument,
  position: vscode.Position
): { start: number; end: number } | undefined {
  // Simple approach: scan backwards from cursor to find the nearest defmodule
  // Then scan forward to find all the content until the file ends or next top-level defmodule
  let moduleStart = -1;

  for (let i = position.line; i >= 0; i--) {
    const line = document.lineAt(i).text;
    if (/^defmodule\b/.test(line)) {
      moduleStart = i;
      break;
    }
  }

  if (moduleStart === -1) {
    return undefined;
  }

  // Find the end: look for the next top-level defmodule or end of file
  // The module's closing `end` is the last `end` before the next defmodule (or EOF)
  let moduleEnd = document.lineCount - 1;

  for (let i = moduleStart + 1; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;
    if (/^defmodule\b/.test(line)) {
      // The previous non-empty line should be the `end` of our module
      moduleEnd = i - 1;
      break;
    }
  }

  return { start: moduleStart, end: moduleEnd };
}

export function findStateDefinitions(
  document: vscode.TextDocument,
  variableName: string,
  moduleRange: { start: number; end: number }
): vscode.Location[] {
  const locations: vscode.Location[] = [];
  const esc = escapeRegex(variableName);

  const patterns = [
    // put_state(component, :key, value)
    new RegExp(`put_state\\s*\\([^,]+,\\s*:${esc}\\b`),
    // |> put_state(:key, value)  (piped form)
    new RegExp(`put_state\\s*\\(\\s*:${esc}\\b`),
    // put_state(component, key: value) keyword list
    new RegExp(`put_state\\s*\\([^,]+,\\s*${esc}:\\s`),
    // put_state(component, %{key: value})
    new RegExp(`put_state\\s*\\([^,]+,\\s*%\\{[^}]*\\b${esc}:`),
    // put_state(component, [:path, :key], value)  or  |> put_state([:path, :key], value)
    new RegExp(`put_state\\s*\\([^\\]]*:${esc}`),
    // prop :name, :type  or  prop(:name, :type)
    new RegExp(`^\\s*prop[\\s(]+:${esc}\\b`),
  ];

  for (let i = moduleRange.start; i <= moduleRange.end; i++) {
    const line = document.lineAt(i).text;

    for (const pattern of patterns) {
      if (pattern.test(line)) {
        const colonNameIndex = line.indexOf(`:${variableName}`);
        const keywordMatch = line.match(new RegExp(`\\b${esc}:\\s`));
        const nameIndex = colonNameIndex !== -1 ? colonNameIndex : (keywordMatch?.index ?? -1);

        if (nameIndex !== -1) {
          locations.push(new vscode.Location(document.uri, new vscode.Position(i, nameIndex)));
          break;
        }
      }
    }
  }

  return locations;
}

export function findActionDefinitions(
  document: vscode.TextDocument,
  actionName: string,
  moduleRange: { start: number; end: number }
): vscode.Location[] {
  const locations: vscode.Location[] = [];
  const esc = escapeRegex(actionName);

  // def action(:name, params, component) do
  const actionPattern = new RegExp(`^\\s*def\\s+action\\s*\\(\\s*:${esc}\\b`);
  // def command(:name, params, server) do
  const commandPattern = new RegExp(`^\\s*def\\s+command\\s*\\(\\s*:${esc}\\b`);

  for (let i = moduleRange.start; i <= moduleRange.end; i++) {
    const line = document.lineAt(i).text;

    if (actionPattern.test(line) || commandPattern.test(line)) {
      const nameIndex = line.indexOf(`:${actionName}`);
      if (nameIndex !== -1) {
        locations.push(new vscode.Location(document.uri, new vscode.Position(i, nameIndex)));
      }
    }
  }

  return locations;
}

export function findFunctionDefinitions(
  document: vscode.TextDocument,
  funcName: string,
  moduleRange: { start: number; end: number }
): vscode.Location[] {
  const locations: vscode.Location[] = [];
  const esc = escapeRegex(funcName);

  // def func_name(...) or defp func_name(...)
  const pattern = new RegExp(`^\\s*defp?\\s+${esc}\\s*[\\(]`);

  const seen = new Set<number>();

  for (let i = moduleRange.start; i <= moduleRange.end; i++) {
    const line = document.lineAt(i).text;

    if (pattern.test(line) && !seen.has(i)) {
      seen.add(i);
      const nameIndex = line.indexOf(funcName);
      if (nameIndex !== -1) {
        locations.push(new vscode.Location(document.uri, new vscode.Position(i, nameIndex)));
      }
    }
  }

  return locations;
}

export function isHologramModule(text: string): boolean {
  return /^\s*use\s+Hologram\.(Component|Page)\s*$/m.test(text);
}

export function resolveComponentName(
  componentName: string,
  document: vscode.TextDocument
): string | undefined {
  if (componentName.includes('.')) {
    return componentName;
  }

  const text = document.getText();

  // alias MyApp.Components.Counter
  const aliasPattern = new RegExp(`^\\s*alias\\s+(\\S+\\.${escapeRegex(componentName)})\\s*$`, 'm');
  const aliasMatch = aliasPattern.exec(text);
  if (aliasMatch) {
    return aliasMatch[1];
  }

  // alias MyApp.Components.Ctr, as: Counter
  const aliasAsPattern = new RegExp(`^\\s*alias\\s+(\\S+),\\s*as:\\s*${escapeRegex(componentName)}\\s*$`, 'm');
  const aliasAsMatch = aliasAsPattern.exec(text);
  if (aliasAsMatch) {
    return aliasAsMatch[1];
  }

  // alias MyApp.Components.{Counter, Button}
  const groupAliasPattern = /^\s*alias\s+(\S+)\.\{([^}]+)\}/gm;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupAliasPattern.exec(text)) !== null) {
    const base = groupMatch[1];
    const names = groupMatch[2].split(',').map(n => n.trim());
    if (names.includes(componentName)) {
      return `${base}.${componentName}`;
    }
  }

  return undefined;
}

export async function findComponentLocations(
  componentName: string,
  currentDocument: vscode.TextDocument
): Promise<ComponentLocations[]> {
  const fullName = resolveComponentName(componentName, currentDocument);
  const namesToSearch = fullName ? [fullName, componentName] : [componentName];

  const files = await vscode.workspace.findFiles(
    '**/*.{ex,exs}',
    '{**/deps/**,**/node_modules/**,**/_build/**}'
  );

  const results: ComponentLocations[] = [];

  for (const fileUri of files) {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const text = doc.getText();

    for (const name of namesToSearch) {
      const pattern = new RegExp(
        `^\\s*defmodule\\s+(\\S*\\.)?${escapeRegex(name)}\\s+do`,
        'm'
      );
      const match = pattern.exec(text);

      if (match && isHologramModule(text)) {
        const locs: ComponentLocations = {};

        locs.module = new vscode.Location(fileUri, doc.positionAt(match.index));

        const templateMatch = /^\s*def\s+template\b/m.exec(text);
        if (templateMatch) {
          locs.template = new vscode.Location(fileUri, doc.positionAt(templateMatch.index));
        }

        const initMatch = /^\s*def\s+init\b/m.exec(text);
        if (initMatch) {
          locs.init = new vscode.Location(fileUri, doc.positionAt(initMatch.index));
        }

        results.push(locs);
        break; // found this name, don't search other name variants in same file
      }
    }
  }

  return results;
}

export async function findPageModule(
  pageName: string,
  currentDocument: vscode.TextDocument
): Promise<vscode.Location | undefined> {
  // Resolve alias if it's a short name
  const fullName = resolveComponentName(pageName, currentDocument) ?? pageName;
  const namesToSearch = fullName !== pageName ? [fullName, pageName] : [pageName];

  const files = await vscode.workspace.findFiles(
    '**/*.{ex,exs}',
    '{**/deps/**,**/node_modules/**,**/_build/**}'
  );

  for (const fileUri of files) {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const text = doc.getText();

    // Must have `use Hologram.Page`
    if (!/^\s*use\s+Hologram\.Page\s*$/m.test(text)) {
      continue;
    }

    for (const name of namesToSearch) {
      const esc = escapeRegex(name);
      const pattern = new RegExp(`^\\s*defmodule\\s+${esc}\\s+do`, 'm');
      const match = pattern.exec(text);

      if (match) {
        // Jump to template if it exists, otherwise to defmodule
        const templateMatch = /^\s*def\s+template\b/m.exec(text);
        if (templateMatch) {
          return new vscode.Location(fileUri, doc.positionAt(templateMatch.index));
        }
        return new vscode.Location(fileUri, doc.positionAt(match.index));
      }
    }
  }

  return undefined;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
