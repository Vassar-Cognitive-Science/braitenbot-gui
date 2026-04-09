import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import './App.css';

export function App() {
  return (
    <div className="app">
      <main className="app-main">
        <header className="minimal-header">
          <h1>BraitenBot Diagram Editor</h1>
          <p>Drag nodes, connect them, then open each node or connection config menu to set ports and weights.</p>
        </header>
        <BraitenbergDiagram />
      </main>
    </div>
  );
}
