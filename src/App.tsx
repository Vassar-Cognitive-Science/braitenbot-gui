import { useCallback, useState } from 'react';
import { Header } from './components/Header';
import { BraitenbergDiagram } from './components/BraitenbergDiagram';
import { ConnectionControls } from './components/ConnectionControls';
import { VehiclePresets } from './components/VehiclePresets';
import { SimulationCanvas } from './components/SimulationCanvas';
import { ArduinoPanel } from './components/ArduinoPanel';
import { useSerial } from './hooks/useSerial';
import { useVehicle } from './hooks/useVehicle';
import { ArduinoSerial } from './serial/ArduinoSerial';
import './App.css';

export function App() {
  const { state: vehicleState, setWeight, applyPreset } = useVehicle();
  const { state: serialState, connect, disconnect, uploadWeights } = useSerial();
  const serialSupported = ArduinoSerial.isSupported();

  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const handleUpload = useCallback(async () => {
    try {
      await uploadWeights(vehicleState.weights);
      setUploadMsg('✓ Uploaded successfully');
    } catch (err) {
      setUploadMsg(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setUploadMsg(null), 3000);
  }, [uploadWeights, vehicleState.weights]);

  return (
    <div className="app">
      <Header
        serialState={serialState}
        onConnect={connect}
        onDisconnect={disconnect}
        serialSupported={serialSupported}
      />

      <main className="app-main">
        {/* Left column: vehicle editor */}
        <section className="editor-column">
          <div className="diagram-section">
            <h2 className="section-title">Vehicle Schematic</h2>
            <BraitenbergDiagram weights={vehicleState.weights} />
          </div>

          <ConnectionControls
            weights={vehicleState.weights}
            onChange={setWeight}
          />

          <VehiclePresets
            activePreset={vehicleState.activePreset}
            onSelect={applyPreset}
          />

          <ArduinoPanel
            serialState={serialState}
            weights={vehicleState.weights}
            onUpload={handleUpload}
            serialSupported={serialSupported}
          />

          {uploadMsg && (
            <div
              className={`upload-toast ${uploadMsg.startsWith('✓') ? 'toast-ok' : 'toast-err'}`}
            >
              {uploadMsg}
            </div>
          )}
        </section>

        {/* Right column: simulation */}
        <section className="simulation-column">
          <SimulationCanvas weights={vehicleState.weights} />
        </section>
      </main>
    </div>
  );
}
