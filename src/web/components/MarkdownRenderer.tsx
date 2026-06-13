/**
 * MarkdownRenderer - react-markdown + remark-gfm + highlight.js
 */

import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { Copy, Check } from 'lucide-react';

// highlight.js 按需导入
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdownLang from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('plaintext', plaintext);

// ─── 代码块组件 ───

interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
}

function CodeBlock({ inline, className, children, node, ...props }: CodeProps) {
  const [copied, setCopied] = useState(false);

  const codeText = String(children ?? '').replace(/\n$/, '');
  const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';

  // react-markdown v9 不传 inline prop，改用：没有 language- class 且内容无换行 = 行内代码
  const isInline = inline ?? (!className?.startsWith('language-') && !codeText.includes('\n'));

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [codeText]);

  if (isInline) {
    return <code className={className} {...props}>{children}</code>;
  }

  // 语法高亮：优先指定语言，否则 autoDetect
  let highlighted = '';
  try {
    highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(codeText, { language: lang, ignoreIllegals: true }).value
      : hljs.highlightAuto(codeText).value;
  } catch {
    highlighted = codeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return (
    <div className="md-code-wrapper">
      <div className="md-code-header">
        {lang && <span className="md-code-lang">{lang}</span>}
        <button
          className={`md-code-copy${copied ? ' copied' : ''}`}
          onClick={handleCopy}
          title="复制代码"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="hljs md-code-pre">
        <code
          className={`hljs${lang ? ` language-${lang}` : ''}`}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlighted) }}
        />
      </pre>
    </div>
  );
}

// ─── 主组件 ───

interface MarkdownRendererProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
}

export function MarkdownRenderer({ text, isStreaming, className }: MarkdownRendererProps) {
  if (!text) return null;

  return (
    <div className={['md-prose', isStreaming ? 'streaming-cursor' : '', className ?? ''].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock as React.ComponentType<React.HTMLAttributes<HTMLElement> & { inline?: boolean }>,
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
