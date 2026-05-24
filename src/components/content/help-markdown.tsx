import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { cn } from '@/lib/utils';

interface HelpMarkdownProps {
  content: string;
  className?: string;
}

export function normalizeHelpMarkdown(content: string): string {
  return content.replace(/^<span id="disable_router_nav_history_direction_check"><\/span>\s*/i, '');
}

/** Renders legacy wallet help markdown (FAQ, Terms of Service). */
export function HelpMarkdown({ content, className }: HelpMarkdownProps) {
  const normalized = normalizeHelpMarkdown(content);

  return (
    <article
      className={cn(
        'help-markdown text-foreground max-w-none text-base leading-relaxed',
        '[&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold',
        '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold',
        '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold',
        '[&_p]:mb-4 [&_li]:mb-1',
        '[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6',
        '[&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:opacity-90',
        '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse',
        '[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {normalized}
      </ReactMarkdown>
    </article>
  );
}
