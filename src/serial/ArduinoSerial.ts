import type { VehicleWeights } from '../types';

const BAUD_RATE = 115200;

/**
 * Wraps the Web Serial API to communicate with an Arduino running the
 * BraitenBot firmware.  The protocol is newline-delimited JSON:
 *
 *   → {"ll":0.8,"lr":0.0,"rl":0.0,"rr":0.8}\n   (host → Arduino)
 *   ← {"status":"ok"}\n                           (Arduino → host)
 */
export class ArduinoSerial {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readBuffer = '';

  /** Returns true when the Web Serial API is available in this browser. */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  /**
   * Prompts the user to select a serial port, then opens it.
   * Resolves when the port is open and ready.
   */
  async connect(): Promise<void> {
    if (!ArduinoSerial.isSupported()) {
      throw new Error(
        'Web Serial API is not supported. Please use Chrome or Edge.',
      );
    }

    this.port = await navigator.serial.requestPort({
      filters: [
        // Arduino Uno / Nano / Mega
        { usbVendorId: 0x2341 },
        // Arduino (clone) via CH340
        { usbVendorId: 0x1a86 },
        // FTDI (common on older Arduinos)
        { usbVendorId: 0x0403 },
      ],
    });

    await this.port.open({ baudRate: BAUD_RATE });

    if (this.port.writable) {
      this.writer = this.port.writable.getWriter();
    }
    if (this.port.readable) {
      this.reader = this.port.readable.getReader();
    }
  }

  /**
   * Sends vehicle connection weights to the Arduino.
   * Each weight is a number in the range [-1, 1].
   */
  async sendWeights(weights: VehicleWeights): Promise<void> {
    if (!this.writer) {
      throw new Error('Not connected to an Arduino.');
    }

    const payload =
      JSON.stringify({
        ll: round3(weights.ll),
        lr: round3(weights.lr),
        rl: round3(weights.rl),
        rr: round3(weights.rr),
      }) + '\n';

    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(payload));
  }

  /**
   * Reads one newline-terminated line from the Arduino.
   * Useful for reading acknowledgement messages.
   */
  async readLine(): Promise<string> {
    if (!this.reader) {
      throw new Error('Not connected to an Arduino.');
    }

    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await this.reader.read();
      if (done) {
        throw new Error('Serial stream closed before a complete line was received.');
      }

      this.readBuffer += decoder.decode(value, { stream: true });
      const newlineIndex = this.readBuffer.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = this.readBuffer.slice(0, newlineIndex);
        this.readBuffer = this.readBuffer.slice(newlineIndex + 1);
        return line;
      }
    }
    // Unreachable — loop only exits via throw or return above
    return this.readBuffer;
  }

  /** Closes the serial connection and releases the port. */
  async disconnect(): Promise<void> {
    try {
      if (this.reader) {
        await this.reader.cancel();
      }
    } catch {
      // ignore cancel errors
    } finally {
      this.reader = null;
    }

    try {
      if (this.writer) {
        await this.writer.close();
      }
    } catch {
      // ignore close errors
    } finally {
      this.writer = null;
    }

    try {
      if (this.port) {
        await this.port.close();
      }
    } catch {
      // ignore close errors
    } finally {
      this.port = null;
    }

    this.readBuffer = '';
  }

  get isConnected(): boolean {
    return this.port !== null && this.writer !== null;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
