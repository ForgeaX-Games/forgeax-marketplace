import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installObservatoryActions } from './lib/observatory-actions';
import { installShortcutForwarder } from './lib/shortcut-forwarder';
import './styles/observatory.css';

createRoot(document.getElementById('root')!).render(<App />);

// 插件桥样板:经 host-sdk surface 向 host 声明本插件可调用的 action,让模型/命令面板能操作插件内部。
installObservatoryActions();
// todo 004:把全局快捷键(⌘K 命令面板 / Ctrl+Shift+* / Esc)从本 iframe 转发给顶层 host。
installShortcutForwarder();
