import { Bot, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

import { cx } from './ui';

type Line = { role: 'user' | 'assistant'; content: string; failed?: boolean };

const STORE = 'help-chat';
/** What the server takes: the last few lines, ending with the question. */
const SENT_LINES = 12;
const MAX_QUESTION = 500;

function loadLines(): Line[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as Line[];
    return Array.isArray(saved) ? saved.filter((line) => !line.failed) : [];
  } catch {
    return [];
  }
}

function saveLines(lines: Line[]) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(lines.slice(-30)));
  } catch {
    // Private mode: the chat just starts fresh on the next page load.
  }
}

/**
 * The help chat: answers questions about using the site, from the site's
 * own guide and FAQ. Full screen on a phone, a card in the corner on a
 * computer. The conversation lasts for the visit (this tab).
 */
export default function HelpChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tr } = useI18n();
  const [lines, setLines] = useState<Line[]>(loadLines);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => saveLines(lines), [lines]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines, waiting, open]);
  useEffect(() => {
    if (!open) return;
    // A computer gets the cursor in the box; a phone keeps its keyboard down until the visitor taps.
    if (window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ask = async (question: string) => {
    const text = question.trim().slice(0, MAX_QUESTION);
    if (!text || waiting) return;
    // A question that failed before is asked again, not kept twice.
    const before = lines.filter((line) => !line.failed);
    const next: Line[] = [...before, { role: 'user', content: text }];
    setLines(next);
    setDraft('');
    setWaiting(true);
    try {
      let sent = next.slice(-SENT_LINES);
      while (sent[0]?.role !== 'user') sent = sent.slice(1);
      const { reply } = await post<{ reply: string | null }>('/assistant', { messages: sent.map(({ role, content }) => ({ role, content })) });
      const answer = reply ?? tr('معنديش إجابة على ده. شوف [صفحة المساعدة](/help) أو كلّم الدعم.', "I don't have an answer for that. See the [help page](/help) or contact support.");
      setLines([...next, { role: 'assistant', content: answer }]);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : tr('حصلت مشكلة، جرّب تاني.', 'Something went wrong. Please try again.');
      setLines([...next, { role: 'assistant', content: message, failed: true }]);
    } finally {
      setWaiting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  };
  const lastFailed = lines.at(-1)?.failed ? lines.at(-2)?.content : undefined;

  const suggestions = [
    tr('إزاي أبيع قطعة؟', 'How do I sell a part?'),
    tr('إزاي أسجّل محلي؟', 'How do I register my shop?'),
    tr('مش لاقي القطعة، أعمل إيه؟', "I can't find a part. What can I do?"),
    tr('إزاي أحمي نفسي من النصب؟', 'How do I avoid scams?'),
    tr('إزاي أنزّل التطبيق؟', 'How do I install the app?'),
  ];

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={tr('مساعد عربيتي', '3arabity assistant')}
      className={cx(
        open ? 'flex' : 'hidden',
        'fixed inset-0 z-50 flex-col bg-canvas md:inset-auto md:bottom-6 md:end-6 md:h-[min(600px,calc(100vh-3rem))] md:w-[380px] md:overflow-hidden md:rounded-2xl md:shadow-2xl md:ring-1 md:ring-line',
      )}
    >
      <header className="flex items-center gap-3 bg-navy px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold leading-6">{tr('مساعد عربيتي', '3arabity assistant')}</p>
          <p className="text-xs text-white/70">{tr('بيرد على أسئلتك عن استخدام الموقع', 'Answers your questions about using the site')}</p>
        </div>
        {lines.length > 0 && (
          <button onClick={() => setLines([])} className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label={tr('محادثة جديدة', 'New chat')} title={tr('محادثة جديدة', 'New chat')}>
            <RotateCcw className="h-5 w-5" />
          </button>
        )}
        <button onClick={onClose} className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label={tr('اقفل', 'Close')}>
          <X className="h-5 w-5" />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4" aria-live="polite">
        <Bubble role="assistant">
          {tr('أهلاً! أنا مساعد عربيتي. اسألني عن البيع، المحلات، طلب قطعة مش لاقيها، أو أي حاجة في الموقع.', "Hi! I'm the 3arabity assistant. Ask me about selling, shops, requesting a part you can't find, or anything on the site.")}
        </Bubble>
        {lines.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((question) => (
              <button key={question} onClick={() => void ask(question)} className="rounded-full bg-white px-3 py-1.5 text-sm font-bold text-navy ring-1 ring-line hover:ring-navy">
                {question}
              </button>
            ))}
          </div>
        )}
        {lines.map((line, index) => (
          <Bubble key={index} role={line.role} failed={line.failed} onNavigate={onClose}>
            {line.content}
          </Bubble>
        ))}
        {lastFailed && !waiting && (
          <button onClick={() => void ask(lastFailed)} className="text-sm font-bold text-orange-deep hover:underline">
            {tr('جرّب تاني', 'Try again')}
          </button>
        )}
        {waiting && (
          <div className="flex w-16 items-center justify-center gap-1 rounded-2xl rounded-ss-md bg-white px-3 py-3 ring-1 ring-line" aria-label={tr('بيكتب…', 'Typing…')}>
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="h-2 w-2 animate-bounce rounded-full bg-ink-muted" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-line bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={MAX_QUESTION}
          placeholder={tr('اكتب سؤالك…', 'Type your question…')}
          aria-label={tr('سؤالك', 'Your question')}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl bg-canvas px-3 py-2.5 text-base leading-6 outline-none ring-1 ring-line focus:ring-2 focus:ring-navy"
        />
        <button
          type="submit"
          disabled={!draft.trim() || waiting}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange text-white transition hover:bg-orange-deep disabled:opacity-40"
          aria-label={tr('ابعت', 'Send')}
        >
          <SendHorizontal className="h-5 w-5 rtl:-scale-x-100" />
        </button>
      </form>
      <p className="bg-white px-3 pb-2 text-center text-[11px] text-ink-muted">{tr('ردود آلية وممكن تغلط. متكتبش بيانات شخصية.', 'Automated answers can be wrong. Don\'t share personal details.')}</p>
    </div>
  );
}

function Bubble({ role, failed, onNavigate, children }: { role: Line['role']; failed?: boolean; onNavigate?: () => void; children: string }) {
  const mine = role === 'user';
  return (
    <div className={cx('flex', mine ? 'justify-start' : 'justify-end')}>
      <div
        className={cx(
          'max-w-[85%] whitespace-pre-line break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-7',
          mine ? 'rounded-se-md bg-navy text-white' : failed ? 'rounded-ss-md bg-red-50 text-red-800 ring-1 ring-red-200' : 'rounded-ss-md bg-white text-ink ring-1 ring-line',
        )}
      >
        {mine ? children : <Rich text={children} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

/**
 * The few bits of Markdown the assistant writes: links to the site's own
 * pages, **bold**, and "- " list lines. Everything else stays plain text;
 * nothing is ever rendered as HTML.
 */
function Rich({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const rows = text.split('\n');
  return (
    <>
      {rows.map((row, index) => {
        const bullet = /^\s*[-•*]\s+/.test(row);
        const content = inline(bullet ? row.replace(/^\s*[-•*]\s+/, '') : row, onNavigate);
        return (
          <Fragment key={index}>
            {bullet ? (
              <span className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{content}</span>
              </span>
            ) : (
              content
            )}
            {index < rows.length - 1 && !bullet && '\n'}
          </Fragment>
        );
      })}
    </>
  );
}

function inline(text: string, onNavigate?: () => void): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const [, label, href, bold] = match;
    if (bold) parts.push(<strong key={at}>{bold}</strong>);
    // Only the site's own pages become links; anything else stays as its words.
    else if (href?.startsWith('/') && !href.startsWith('//'))
      parts.push(
        <Link key={at} to={href} onClick={() => window.matchMedia('(max-width: 767px)').matches && onNavigate?.()} className="font-bold text-orange-deep underline underline-offset-2">
          {label}
        </Link>,
      );
    else parts.push(label);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
