import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import { SetupModal } from './components/SetupModal';
import { useArduino } from './hooks/useArduino';
import './App.css';

export function App() {
  const arduino = useArduino();

  return (
    <div className="app">
      <main className="app-main">
        <header className="minimal-header">
          <h1>BraitenBot Diagram Editor</h1>
          <p>Drag nodes, connect them, then open each node or connection config menu to set ports and weights.</p>
        </header>
        <BraitenbergDiagram arduino={arduino} />
      </main>
      <SetupModal arduino={arduino} />
    </div>
  );
}
