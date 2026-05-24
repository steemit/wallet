import fs from 'fs';
import path from 'path';

/** Load English help markdown from `src/content/help/en/`. */
export function readHelpMarkdown(name: 'faq' | 'tos'): string {
  const filePath = path.join(process.cwd(), 'src/content/help/en', `${name}.md`);
  return fs.readFileSync(filePath, 'utf8');
}
