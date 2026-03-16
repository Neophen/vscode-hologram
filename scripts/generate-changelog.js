const { execSync } = require('child_process');
const fs = require('fs');

const version = require('../package.json').version;

// Get the last tag
let lastTag;
try {
  lastTag = execSync('git describe --tags --abbrev=0 HEAD~1', { encoding: 'utf8' }).trim();
} catch {
  lastTag = execSync('git rev-list --max-parents=0 HEAD', { encoding: 'utf8' }).trim();
}

console.log(`Generating changelog for v${version} (since ${lastTag})...\n`);

// Get the diff summary and commit messages
const commits = execSync(`git log ${lastTag}..HEAD --oneline`, { encoding: 'utf8' }).trim();
const diffStat = execSync(`git diff ${lastTag}..HEAD --stat`, { encoding: 'utf8' }).trim();
const diff = execSync(`git diff ${lastTag}..HEAD -- src/ package.json`, { encoding: 'utf8' }).trim();

// Read existing changelog
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

const prompt = `You are generating a changelog entry for version ${version} of a VS Code extension called "Hologram" (for the Hologram Elixir framework).

Here are the commits since the last release (${lastTag}):
${commits}

Here is the diff stat:
${diffStat}

Here is the actual code diff (src/ and package.json only):
${diff}

Generate a concise changelog entry in this exact format:

## ${version}

### New Features (only if there are new features)
- **Feature name** — short description

### Improvements (only if there are improvements)
- Description of improvement

### Fixes (only if there are fixes)
- Description of fix

Rules:
- Only include sections that have entries
- Be concise — one line per change
- Focus on user-visible changes, skip internal refactoring unless significant
- Use bold for feature names
- Do NOT include the "# Changelog" header
- Do NOT include previous versions
- Output ONLY the markdown for this version`;

try {
  const result = execSync(
    `claude --print --model sonnet "${prompt.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60000 }
  ).trim();

  // Prepend to changelog (after the "# Changelog" header)
  const updated = changelog.replace(
    '# Changelog\n',
    `# Changelog\n\n${result}\n`
  );

  fs.writeFileSync('CHANGELOG.md', updated);
  console.log('\nChangelog updated:\n');
  console.log(result);
} catch (err) {
  console.error('Failed to generate changelog with Claude. Falling back to manual entry.');
  console.error(err.message);

  // Fallback: create a basic entry from commits
  const entry = `## ${version}\n\n${commits.split('\n').map(c => `- ${c.replace(/^[a-f0-9]+ /, '')}`).join('\n')}`;
  const updated = changelog.replace(
    '# Changelog\n',
    `# Changelog\n\n${entry}\n`
  );
  fs.writeFileSync('CHANGELOG.md', updated);
  console.log('\nBasic changelog entry created from commits:\n');
  console.log(entry);
}
