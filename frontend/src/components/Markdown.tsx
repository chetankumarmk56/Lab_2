import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
}

/**
 * Renders agent Markdown (GitHub-flavored, so tables/strikethrough work) into
 * real, styled HTML — turning raw `| col |` text and ```sql fences into proper
 * tables and code blocks.
 */
export default function Markdown({ children }: MarkdownProps) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
    </div>
  )
}
