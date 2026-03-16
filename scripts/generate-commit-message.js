const { execSync } = require('child_process');

const diff = execSync('git diff --cached --stat', { encoding: 'utf8' }).trim();

if (!diff) {
  console.log('pre-release changes');
  process.exit(0);
}

const diffContent = execSync('git diff --cached', { encoding: 'utf8' }).trim();

const prompt = `Generate a concise git commit message for these staged changes.

Diff stat:
${diff}

Diff:
${diffContent.slice(0, 8000)}

Rules:
- One line, max 72 characters
- Use conventional commit format: type(scope): description
- Types: feat, fix, chore, refactor, docs, style, ci
- No period at the end
- Be specific about what changed
- Output ONLY the commit message, nothing else`;

try {
  const message = execSync(
    `claude --print --model haiku "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000 }
  ).trim().split('\n')[0]; // Take only the first line

  console.log(message);
} catch {
  console.log('pre-release changes');
}
