import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import './App.css';

export function App() {
  return (
    <div className="app">
      <main className="app-main">
        <header className="minimal-header">
          <h1>BraitenBot Diagram Editor</h1>
          <p>Drag sensors and computation nodes onto the canvas, then drag links into motors.</p>
        </header>
        <BraitenbergDiagram />
      </main>
    </div>
  );
}
