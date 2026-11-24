import { useEditorStore } from '../store';

export function Toast(): JSX.Element | null {
  const toast = useEditorStore((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}