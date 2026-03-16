import * as vscode from 'vscode';
import { resolveComponentName, findEnclosingModule } from './hologramResolver';
import { scanModuleMembers, resolveModuleFields } from './eventCompletionProvider';
import { WorkspaceIndex, ModuleInfo } from './workspaceIndex';

interface PageParam {
  name: string;
  type: string;
}

interface PageContext {
  active: boolean;
  existingValue: string;
  source: 'link_to' | 'put_page';
}

function getPageContext(
  document: vscode.TextDocument,
  position: vscode.Position
): PageContext {
  const line = document.lineAt(position.line).text;
  const textBefore = line.substring(0, position.character);
  const none: PageContext = { active: false, existingValue: '', source: 'link_to' };

  // 1. Check put_page(component, PageModule) or |> put_page(PageModule)
  const putPageMatch = textBefore.match(/put_page\s*\([^,]*,\s*([A-Za-z0-9_.]*)?$/)
    || textBefore.match(/put_page\s*\(\s*([A-Za-z0-9_.]*)?$/);
  if (putPageMatch) {
    return { active: true, existingValue: putPageMatch[1] || '', source: 'put_page' };
  }

  // 2. Check <Link to={PageModule}
  const fullText = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

  let lastOpenTag = -1;
  let lastCloseTag = -1;
  for (let i = fullText.length - 1; i >= 0; i--) {
    if (fullText[i] === '<' && lastOpenTag === -1) {
      lastOpenTag = i;
    }
    if (fullText[i] === '>' && lastCloseTag === -1) {
      lastCloseTag = i;
    }
    if (lastOpenTag !== -1 && lastCloseTag !== -1) break;
  }

  if (lastOpenTag <= lastCloseTag) return none;

  const tagContent = fullText.substring(lastOpenTag);
  if (!/^<Link\b/.test(tagContent)) return none;

  const toMatch = textBefore.match(/to=\{?\s*([A-Za-z0-9_.]*)?$/);
  if (toMatch) {
    return { active: true, existingValue: toMatch[1] || '', source: 'link_to' };
  }

  return none;
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

/**
 * Try to find a smart default value for a page param by matching against
 * the current component's props/state fields.
 */
function findSmartDefault(
  paramName: string,
  varFields: Map<string, string[]>
): string {
  for (const [varName, fields] of varFields) {
    if (fields.includes(paramName)) {
      return `@${varName}.${paramName}`;
    }
  }
  return paramName;
}

export class PageCompletionProvider implements vscode.CompletionItemProvider {
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
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | undefined> {
    const isElixir = document.languageId === 'elixir';
    const isHologram = document.languageId === 'hologram';

    if (!isElixir && !isHologram) {
      return undefined;
    }

    const pageCtx = getPageContext(document, position);

    if (!pageCtx.active) {
      return undefined;
    }

    if (pageCtx.source === 'link_to' && isElixir && !isInsideHoloSigil(document, position)) {
      return undefined;
    }

    this.outputChannel.appendLine(`--- Page Completion (${pageCtx.source}) ---`);
    this.outputChannel.appendLine(`Existing value: "${pageCtx.existingValue}"`);

    const pages = this.index.getAllPages();
    this.outputChannel.appendLine(`Found ${pages.length} pages`);

    const replaceStart = position.character - pageCtx.existingValue.length;
    const range = new vscode.Range(
      new vscode.Position(position.line, replaceStart),
      position
    );

    // Build alias map from current document to offer short names
    const docText = document.getText();
    const aliases = new Map<string, string>(); // fullName -> shortName

    const aliasRegex = /^\s*alias\s+(\S+?)(?:\.\{([^}]+)\})?\s*$/gm;
    let aliasMatch: RegExpExecArray | null;
    while ((aliasMatch = aliasRegex.exec(docText)) !== null) {
      if (aliasMatch[2]) {
        const base = aliasMatch[1];
        for (const name of aliasMatch[2].split(',').map(n => n.trim())) {
          aliases.set(`${base}.${name}`, name);
        }
      } else {
        const full = aliasMatch[1];
        const parts = full.split('.');
        aliases.set(full, parts[parts.length - 1]);
      }
    }

    const aliasAsRegex = /^\s*alias\s+(\S+),\s*as:\s*(\w+)\s*$/gm;
    while ((aliasMatch = aliasAsRegex.exec(docText)) !== null) {
      aliases.set(aliasMatch[1], aliasMatch[2]);
    }

    // Gather current component's props/state for smart param matching
    const varFields = await this.getCurrentComponentFields(document, position);

    return pages.map((page, index) => {
      const aliasedName = aliases.get(page.fullName);
      const displayName = aliasedName || page.fullName;

      const item = new vscode.CompletionItem(
        displayName,
        vscode.CompletionItemKind.Module
      );

      // Extract params from page props (for page completions, props serve as params)
      const paramNames = page.props.map(p => p.name);
      item.detail = page.route ? `Page (${page.route})` : 'Page';
      if (paramNames.length > 0) {
        item.detail += ` — params: ${paramNames.join(', ')}`;
      }

      const parts = page.fullName.split('.');
      const shortName = parts[parts.length - 1];

      if (aliasedName && aliasedName !== page.fullName) {
        item.documentation = new vscode.MarkdownString(`**${page.fullName}**${page.route ? `\n\nRoute: \`${page.route}\`` : ''}`);
      } else if (page.route) {
        item.documentation = new vscode.MarkdownString(`Route: \`${page.route}\``);
      }

      item.sortText = String(index).padStart(3, '0');
      item.filterText = `${displayName} ${page.fullName} ${shortName}`;
      item.range = range;

      if (page.props.length > 0) {
        const paramSnippets = page.props.map((p, i) => {
          const smartDefault = findSmartDefault(p.name, varFields);
          return `${p.name}: \${${i + 1}:${smartDefault}}`;
        }).join(', ');
        item.insertText = new vscode.SnippetString(`${displayName}, ${paramSnippets}`);
      } else {
        item.insertText = displayName;
      }

      return item;
    });
  }

  private async getCurrentComponentFields(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<Map<string, string[]>> {
    const varFields = new Map<string, string[]>();

    try {
      const moduleRange = findEnclosingModule(document, position);
      if (!moduleRange) return varFields;

      const members = scanModuleMembers(document, moduleRange);

      for (const prop of members.props) {
        let fields: string[] = [];
        if (prop.type !== 'any' && /^[A-Z]/.test(prop.type)) {
          // Try the index first
          const fullName = resolveComponentName(prop.type, document) ?? prop.type;
          fields = this.index.getModuleFields(fullName);
          if (fields.length === 0) {
            fields = await resolveModuleFields(prop.type, document);
          }
        }
        if (fields.length === 0) {
          fields = this.scanTemplateFieldUsage(document, moduleRange, prop.name);
        }
        if (fields.length > 0) {
          varFields.set(prop.name, fields);
        }
      }

      for (const state of members.stateKeys) {
        if (varFields.has(state.name)) continue;
        let fields = state.fields;
        if (fields.length === 0) {
          fields = this.scanTemplateFieldUsage(document, moduleRange, state.name);
        }
        if (fields.length > 0) {
          varFields.set(state.name, fields);
        }
      }
    } catch {
      // Silently fail — smart defaults are optional
    }

    return varFields;
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

// Diagnostics for invalid page references in Link to={...}
export class PageDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private outputChannel: vscode.OutputChannel;
  private index: WorkspaceIndex;
  private disposables: vscode.Disposable[] = [];

  constructor(outputChannel: vscode.OutputChannel, index: WorkspaceIndex) {
    this.outputChannel = outputChannel;
    this.index = index;
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('hologram-pages');

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => this.checkDocument(doc)),
      vscode.workspace.onDidOpenTextDocument(doc => this.checkDocument(doc)),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) this.checkDocument(editor.document);
      })
    );

    // Re-check when index updates
    this.disposables.push(
      this.index.onDidUpdate(() => {
        if (vscode.window.activeTextEditor) {
          this.checkDocument(vscode.window.activeTextEditor.document);
        }
      })
    );

    if (vscode.window.activeTextEditor) {
      this.checkDocument(vscode.window.activeTextEditor.document);
    }
  }

  async checkDocument(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'elixir' && document.languageId !== 'hologram') {
      return;
    }

    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];

    const pages = this.index.getAllPages();
    const pageNames = new Set(pages.map(p => p.fullName));

    const patterns: { regex: RegExp; nameGroupIndex: number; offsetToName: (match: RegExpExecArray) => number }[] = [
      {
        regex: /to=\{([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)(?:\s*[,}])/g,
        nameGroupIndex: 1,
        offsetToName: (m) => m[0].indexOf(m[1]),
      },
      {
        regex: /put_page\s*\([^,]+,\s*([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)(?:\s*[,)])/g,
        nameGroupIndex: 1,
        offsetToName: (m) => m[0].indexOf(m[1]),
      },
      {
        regex: /put_page\s*\(\s*([A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)*)(?:\s*[,)])/g,
        nameGroupIndex: 1,
        offsetToName: (m) => m[0].indexOf(m[1]),
      },
    ];

    for (const { regex, nameGroupIndex, offsetToName } of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const pageName = match[nameGroupIndex];

        const fullName = resolveComponentName(pageName, document) ?? pageName;

        if (pageNames.has(fullName) || pageNames.has(pageName)) {
          continue;
        }

        const nameOffset = offsetToName(match);
        const startPos = document.positionAt(match.index + nameOffset);
        const endPos = document.positionAt(match.index + nameOffset + pageName.length);
        const range = new vscode.Range(startPos, endPos);

        const similar = findSimilarPages(pageName, pages);
        let message = `Page module "${pageName}" does not exist.`;
        if (similar.length > 0) {
          message += ` Did you mean: ${similar.map(p => p.fullName).join(', ')}?`;
        }

        const diagnostic = new vscode.Diagnostic(
          range,
          message,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'Hologram';
        diagnostic.code = 'unknown-page';
        diagnostics.push(diagnostic);
      }
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  dispose(): void {
    this.diagnosticCollection.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function findSimilarPages(name: string, pages: ModuleInfo[]): ModuleInfo[] {
  const nameLower = name.toLowerCase();
  const nameParts = name.split('.');
  const lastPart = nameParts[nameParts.length - 1].toLowerCase();

  return pages
    .map(page => {
      const pageParts = page.fullName.split('.');
      const pageLastPart = pageParts[pageParts.length - 1].toLowerCase();

      let score = 0;

      if (pageLastPart === lastPart) score += 100;
      else if (pageLastPart.includes(lastPart) || lastPart.includes(pageLastPart)) score += 50;
      else {
        let shared = 0;
        for (let i = 0; i < Math.min(pageLastPart.length, lastPart.length); i++) {
          if (pageLastPart[i] === lastPart[i]) shared++;
          else break;
        }
        score += shared * 10;
      }

      if (page.fullName.toLowerCase().includes(nameLower)) score += 30;

      return { page, score };
    })
    .filter(({ score }) => score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ page }) => page);
}
