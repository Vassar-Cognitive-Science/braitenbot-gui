import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import { SetupModal } from './components/SetupModal';
import { useArduino } from './hooks/useArduino';
import './App.css';

export function App() {
  const arduino = useArduino();

  return (
    <div className="app">
      <main className="app-main">
        <BraitenbergDiagram arduino={arduino} />
      </main>
      <SetupModal arduino={arduino} />
    </div>
  );
}
