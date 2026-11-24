import { Viewport } from './components/Viewport';
import { TopBar } from './components/TopBar';
import { SidePanel } from './components/SidePanel';
import { ProfileChart } from './components/ProfileChart';
import { Toast } from './components/Toast';

export default function App(): JSX.Element {
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <SidePanel />
        <div className="stage">
          <Viewport />
          <ProfileChart />
        </div>
      </div>
      <Toast />
    </div>
  );
}
