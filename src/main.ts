import './styles.css';
import './components/eye-workbench';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  root.innerHTML = '<eye-workbench></eye-workbench>';
}
