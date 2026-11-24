/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { planner } from './store/store';
import './styles.css';

// 暴露权威 store 单例，供自动化测试与控制台调试使用
(window as unknown as { __wvp?: typeof planner }).__wvp = planner;

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');
render(() => <App />, root);
