import { useEffect, useRef } from 'react';
import { useObservatoryStore } from '../../store/observatoryStore';

export function SearchBar() {
  const { searchQuery, setSearchQuery } = useObservatoryStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = searchQuery !== '' || false;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearchQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSearchQuery]);

  return (
    <div className="ob-search" style={{ opacity: visible ? 1 : 0.6 }}>
      <span style={{ fontSize: 12, color: 'var(--ob-node-text-dim)' }}>⌘K</span>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search nodes..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      {searchQuery && (
        <button type="button" onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--ob-node-text-dim)', cursor: 'pointer', fontSize: 12 }}>✕</button>
      )}
    </div>
  );
}
