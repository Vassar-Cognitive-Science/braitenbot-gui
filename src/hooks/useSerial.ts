import { useState, useCallback, useRef } from 'react';
import { ArduinoSerial } from '../serial/ArduinoSerial';
import type { SerialState, VehicleWeights } from '../types';

/**
 * Custom hook that manages the lifecycle of a Web Serial connection to an
 * Arduino.  Exposes connect/disconnect/upload actions and the current
 * connection state.
 */
export function useSerial() {
  const serialRef = useRef<ArduinoSerial>(new ArduinoSerial());
  const [state, setState] = useState<SerialState>({
    status: 'disconnected',
    error: null,
  });

  const connect = useCallback(async () => {
    setState({ status: 'connecting', error: null });
    try {
      await serialRef.current.connect();
      setState({ status: 'connected', error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', error: message });
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await serialRef.current.disconnect();
    } catch {
      // best-effort disconnect
    }
    setState({ status: 'disconnected', error: null });
  }, []);

  const uploadWeights = useCallback(
    async (weights: VehicleWeights): Promise<void> => {
      if (!serialRef.current.isConnected) {
        throw new Error('Not connected to an Arduino.');
      }
      await serialRef.current.sendWeights(weights);
    },
    [],
  );

  return { state, connect, disconnect, uploadWeights };
}
