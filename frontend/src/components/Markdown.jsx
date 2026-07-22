import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renders agent Markdown (GitHub-flavored, so tables/strikethrough work) into
 * real, styled HTML. This is what turns the raw `| col | col |` text and
 * ```sql fences into proper tables and code blocks.
 */
export default function Markdown({ children }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
    </div>
  )
}
