// Un bloque comienza con Recibido o Paquete recibido. La línea Temperatura
// complementa el bloque; nunca genera otra medición dentro del mismo paquete.
export class PacketParser {
  constructor(emit, delay = 180) {
    this.emit = emit;
    this.delay = delay;
    this.pending = null;
    this.timer = null;
    this.framed = false;
    this.awaitingPacket = false;
    this.dataMode = false;
    this.lastSequence = null;
    this.nextMetadata = {};
    this.ykMode = false;
  }
  flush() {
    clearTimeout(this.timer);
    if (
      this.pending &&
      (this.pending.format === "DATA" ||
        this.pending.format === "YK" ||
        Number.isFinite(this.pending.temperature))
    )
      this.emit({ ...this.pending });
    this.pending = null;
  }
  reset() {
    clearTimeout(this.timer);
    this.pending = null;
    this.framed = false;
    this.awaitingPacket = false;
    this.dataMode = false;
    this.lastSequence = null;
    this.nextMetadata = {};
    this.ykMode = false;
  }
  feed(raw) {
    const line = raw.trim();
    const yk = /^(?:(?:Recibido:|DATA:)\s*)?(YK,.*)$/.exec(line);
    if (yk) {
      const f = yk[1].split(",").map((v) => v.trim());
      if (f.length !== 11 || !/^\d+$/.test(f[1])) return;
      const seq = Number(f[1]);
      if (!Number.isSafeInteger(seq)) return;
      const values = f
        .slice(2)
        .map((v) =>
          v === "NA" ? null : /^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : NaN,
        );
      if (values.some((v) => v !== null && !Number.isFinite(v))) return;
      const ranges = [
        [-55, 125],
        [0, 14],
        [0, Infinity],
        [0.01, 2000],
        [-80, 100],
        [0, 100],
        [0, 3.3],
        [0, 3.3],
        [0, 3.3],
      ];
      if (
        values.some(
          (v, i) => v !== null && (v < ranges[i][0] || v > ranges[i][1]),
        )
      )
        return;
      if (this.ykMode && seq === this.lastSequence) return;
      const metadata = { ...this.nextMetadata };
      if (this.pending?.format !== "YK")
        for (const k of ["rssi", "snr"])
          if (Number.isFinite(this.pending?.[k])) metadata[k] = this.pending[k];
      if (this.pending?.format === "YK") this.flush();
      else {
        clearTimeout(this.timer);
        this.pending = null;
      }
      this.nextMetadata = {};
      this.lastSequence = seq;
      this.dataMode = true;
      this.ykMode = true;
      const keys = [
        "temperature",
        "ph",
        "conductivity",
        "pressure",
        "ambientTemperature",
        "humidity",
        "phVoltageV",
        "ecVoltageV",
        "odVoltageV",
      ];
      this.pending = {
        ...metadata,
        at: new Date().toISOString(),
        packet: seq,
        format: "YK",
        ...Object.fromEntries(keys.map((k, i) => [k, values[i]])),
      };
      this.timer = setTimeout(() => this.flush(), this.delay);
      return;
    }
    if (this.ykMode) {
      const m = /^(RSSI|SNR):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
      if (m)
        (this.pending || this.nextMetadata)[m[1].toLowerCase()] = Number(m[2]);
      return;
    }
    if (line.startsWith("DATA:")) {
      this.dataMode = true;
      const fields = line
        .slice(5)
        .split(",")
        .map((v) => v.trim());
      if (fields.length !== 5 || !/^\d+$/.test(fields[0])) return;
      const sequence = Number(fields[0]);
      if (!Number.isSafeInteger(sequence) || sequence === this.lastSequence)
        return;
      // El cuarto campo de DATA ya es conductividad calibrada en mS/cm.
      const keys = ["temperature", "ph", "conductivity", "pressure"];
      const values = fields
        .slice(1)
        .map((v) =>
          v === "NA" ? null : /^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : NaN,
        );
      if (values.some((v) => v !== null && !Number.isFinite(v))) return;
      const [t, ph, conductivity, pressure] = values;
      if (
        (t !== null && (t < -55 || t > 125)) ||
        (ph !== null && (ph < 0 || ph > 14)) ||
        (conductivity !== null && conductivity < 0) ||
        (pressure !== null && (pressure <= 0 || pressure > 2000))
      )
        return;
      const metadata = { ...this.nextMetadata };
      if (this.pending?.format !== "DATA")
        for (const key of ["rssi", "snr"])
          if (Number.isFinite(this.pending?.[key]))
            metadata[key] = this.pending[key];
      this.nextMetadata = {};
      // DATA es la fuente autorizada del bloque; descartar un resumen TEMP
      // anterior que aún no se haya emitido evita duplicar el primer paquete.
      if (this.pending?.format === "DATA") this.flush();
      else {
        clearTimeout(this.timer);
        this.pending = null;
      }
      this.lastSequence = sequence;
      this.pending = {
        ...metadata,
        at: new Date().toISOString(),
        packet: sequence,
        format: "DATA",
        ...Object.fromEntries(keys.map((k, i) => [k, values[i]])),
      };
      this.timer = setTimeout(() => this.flush(), this.delay);
      return;
    }
    if (this.dataMode) {
      const metric = /^(RSSI|SNR):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
      if (metric) {
        const target = this.pending || this.nextMetadata;
        target[metric[1].toLowerCase()] = Number(metric[2]);
      }
      return;
    }
    const received = /^(?:Recibido:\s*)?TEMP:\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(
      line,
    );
    const packet = /^Paquete recibido:\s*(\d+)/i.exec(line);
    if (received) {
      this.flush();
      this.framed = true;
      this.awaitingPacket = true;
      this.pending = { at: new Date().toISOString() };
    }
    if (packet) {
      this.framed = true;
      if (this.awaitingPacket && !this.pending) {
        this.awaitingPacket = false;
        return;
      }
      this.awaitingPacket = false;
      if (this.pending?.packet !== undefined) this.flush();
      this.pending ??= { at: new Date().toISOString() };
      this.pending.packet = Number(packet[1]);
    }
    const temp =
      received ||
      /^Temperatura:\s*(-?\d+(?:\.\d+)?)\s*(?:°?C)?\s*$/i.exec(line);
    if (temp) {
      if (!received && this.framed && !this.pending) return;
      const value = Number(temp[1]);
      if (value < -55 || value > 125 || value === -127) return;
      this.pending ??= { at: new Date().toISOString() };
      this.pending.temperature = value;
    }
    const metric = /^(RSSI|SNR):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    if (metric && this.pending)
      this.pending[metric[1].toLowerCase()] = Number(metric[2]);
    if (this.pending) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.delay);
    }
  }
}
