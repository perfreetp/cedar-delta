import { GuidePlannerElement } from './components/guide-planner';

if (!customElements.get('guide-planner')) {
  customElements.define('guide-planner', GuidePlannerElement);
}
