import os from 'os';
import type { Identity } from '../types/index.js';
import { PeerTable } from './peerTable.js';

type NoblePeripheral = {
  id: string;
  rssi: number;
  advertisement: {
    localName?: string;
    manufacturerData?: Buffer;
    serviceData?: Array<{ uuid: string; data: Buffer }>;
    serviceUuids?: string[];
  };
  connect: (cb: (error?: Error | null) => void) => void;
  disconnect: (cb?: (error?: Error | null) => void) => void;
  discoverSomeServicesAndCharacteristics: (
    serviceUuids: string[],
    characteristicUuids: string[],
    cb: (error: Error | null, services: unknown[], characteristics: NobleCharacteristic[]) => void
  ) => void;
};

type NobleCharacteristic = {
  read: (cb: (error: Error | null, data: Buffer) => void) => void;
};

type NobleLike = {
  on: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  startScanning: (serviceUuids: string[], allowDuplicates: boolean, cb?: (error?: Error | null) => void) => void;
  stopScanning: (cb?: () => void) => void;
  state: string;
};

type BlenoCharacteristicCtor = new (options: {
  uuid: string;
  properties: string[];
  onReadRequest: (offset: number, callback: (result: number, data?: Buffer) => void) => void;
}) => unknown;

type BlenoPrimaryServiceCtor = new (options: { uuid: string; characteristics: unknown[] }) => unknown;

type BlenoLike = {
  Characteristic: BlenoCharacteristicCtor;
  PrimaryService: BlenoPrimaryServiceCtor;
  on: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
  setServices: (services: unknown[], cb?: (error?: Error | null) => void) => void;
  startAdvertising: (name: string, serviceUuids: string[], cb?: (error?: Error | null) => void) => void;
  stopAdvertising: (cb?: () => void) => void;
};

const SERVICE_UUID = 'a1c0a1c0a1c0a1c0a1c0a1c0a1c0a1c0';
const CHARACTERISTIC_UUID = 'b1c0b1c0b1c0b1c0b1c0b1c0b1c0b1c0';

function getLanIp(): string {
  const interfaces = os.networkInterfaces() as Record<string, os.NetworkInterfaceInfo[] | undefined>;
  const candidates: string[] = [];

  for (const infos of Object.values(interfaces)) {
    if (!infos) {
      continue;
    }
    for (const info of infos as os.NetworkInterfaceInfo[]) {
      if (info.family !== 'IPv4' || info.internal) {
        continue;
      }
      candidates.push(info.address);
    }
  }

  const privateIp = candidates.find((ip) => {
    return ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
  });

  return privateIp || candidates[0] || '127.0.0.1';
}

function buildPayload(identity: Identity, tcpPort: number): Buffer {
  const payload = {
    node_id: identity.nodeId.slice(0, 8),
    ip: getLanIp(),
    tcp_port: tcpPort
  };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

async function importOptional(moduleName: string): Promise<any | null> {
  try {
    const importer = new Function('m', 'return import(m);') as (m: string) => Promise<any>;
    const mod = await importer(moduleName);
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

function isValidBlePayload(value: unknown): value is { node_id: string; ip: string; tcp_port: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { node_id?: unknown; ip?: unknown; tcp_port?: unknown };
  return (
    typeof candidate.node_id === 'string' &&
    candidate.node_id.length > 0 &&
    typeof candidate.ip === 'string' &&
    candidate.ip.length > 0 &&
    typeof candidate.tcp_port === 'number' &&
    Number.isFinite(candidate.tcp_port)
  );
}

export class BleDiscovery {
  private identity: Identity;
  private tcpPort: number;
  private peerTable: PeerTable;
  private running: boolean;
  private noble: NobleLike | null;
  private bleno: BlenoLike | null;
  private processing: Set<string>;
  private readonly payload: Buffer;
  private readonly localNodeShort: string;
  private nobleStateHandler: ((state: string) => void) | null;
  private nobleDiscoverHandler: ((p: NoblePeripheral) => void) | null;
  private blenoStateHandler: ((state: string) => void) | null;
  private statusInterval: NodeJS.Timeout | null;

  constructor(identity: Identity, tcpPort: number, peerTable: PeerTable) {
    this.identity = identity;
    this.tcpPort = tcpPort;
    this.peerTable = peerTable;
    this.running = false;
    this.noble = null;
    this.bleno = null;
    this.processing = new Set<string>();
    this.payload = buildPayload(identity, tcpPort);
    this.localNodeShort = identity.nodeId.slice(0, 8);
    this.nobleStateHandler = null;
    this.nobleDiscoverHandler = null;
    this.blenoStateHandler = null;
    this.statusInterval = null;
  }

  async start(): Promise<boolean> {
    if (this.running) {
      return true;
    }

    const noble = (await importOptional('@abandonware/noble')) as NobleLike | null;
    if (!noble) {
      return false;
    }

    this.noble = noble;
    this.bleno = (await importOptional('@abandonware/bleno')) as BlenoLike | null;
    this.running = true;

    this.nobleStateHandler = (state: string) => {
      if (!this.running || !this.noble) {
        return;
      }
      if (state === 'poweredOn') {
        this.noble.startScanning([], true);
      } else {
        this.noble.stopScanning();
      }
    };

    this.nobleDiscoverHandler = (peripheral: NoblePeripheral) => {
      void this.handlePeripheral(peripheral);
    };

    this.noble.on('stateChange', this.nobleStateHandler);
    this.noble.on('discover', this.nobleDiscoverHandler);
    if (this.noble.state === 'poweredOn') {
      this.noble.startScanning([], true);
    }

    if (this.bleno) {
      this.blenoStateHandler = (state: string) => {
        if (!this.running || !this.bleno) {
          return;
        }
        if (state !== 'poweredOn') {
          this.bleno.stopAdvertising();
          return;
        }
        this.startAdvertising();
      };
      this.bleno.on('stateChange', this.blenoStateHandler);
    }

    this.statusInterval = setInterval(() => {
      if (!this.running) {
        return;
      }
      console.log(`[BLE] Peers actifs: ${this.peerTable.getAll().length}`);
    }, 15000);

    return true;
  }

  private startAdvertising(): void {
    if (!this.bleno || !this.running) {
      return;
    }

    const payload = this.payload;
    const characteristic = new this.bleno.Characteristic({
      uuid: CHARACTERISTIC_UUID,
      properties: ['read'],
      onReadRequest: (offset: number, callback: (result: number, data?: Buffer) => void): void => {
        const resultOk = 0;
        const invalidOffset = 7;
        if (offset > payload.length) {
          callback(invalidOffset);
          return;
        }
        callback(resultOk, payload.subarray(offset));
      }
    });

    const service = new this.bleno.PrimaryService({
      uuid: SERVICE_UUID,
      characteristics: [characteristic]
    });

    this.bleno.startAdvertising(`arch-${this.localNodeShort}`, [SERVICE_UUID], (error?: Error | null) => {
      if (error || !this.bleno) {
        return;
      }
      this.bleno.setServices([service]);
    });
  }

  private async handlePeripheral(peripheral: NoblePeripheral): Promise<void> {
    if (!this.running || !this.noble) {
      return;
    }
    if (this.processing.has(peripheral.id)) {
      return;
    }
    this.processing.add(peripheral.id);

    try {
      const adPayload = this.tryParseAdvertisement(peripheral);
      const payload = adPayload || (await this.readPayloadFromGatt(peripheral));
      if (!payload) {
        return;
      }
      if (payload.node_id === this.localNodeShort) {
        return;
      }

      this.peerTable.upsert(payload.node_id, {
        ip: payload.ip,
        tcpPort: payload.tcp_port,
        lastSeen: Date.now()
      });
      console.log(`[BLE] Pair: ${payload.node_id} @ ${payload.ip}:${payload.tcp_port} RSSI=${peripheral.rssi} dBm`);
    } finally {
      this.processing.delete(peripheral.id);
    }
  }

  private tryParseAdvertisement(peripheral: NoblePeripheral): { node_id: string; ip: string; tcp_port: number } | null {
    const ad = peripheral.advertisement;
    const rawChunks: Buffer[] = [];

    if (ad.manufacturerData && ad.manufacturerData.length > 0) {
      rawChunks.push(ad.manufacturerData);
    }
    if (Array.isArray(ad.serviceData)) {
      for (const item of ad.serviceData) {
        if (item.data && item.data.length > 0) {
          rawChunks.push(item.data);
        }
      }
    }

    for (const chunk of rawChunks) {
      try {
        const parsed = JSON.parse(chunk.toString('utf8')) as unknown;
        if (isValidBlePayload(parsed)) {
          return parsed;
        }
      } catch {
        // ignore malformed data
      }
    }

    return null;
  }

  private async readPayloadFromGatt(peripheral: NoblePeripheral): Promise<{ node_id: string; ip: string; tcp_port: number } | null> {
    const serviceUuids = [SERVICE_UUID.replace(/-/g, '')];
    const characteristicUuids = [CHARACTERISTIC_UUID.replace(/-/g, '')];

    try {
      await new Promise<void>((resolve, reject) => {
        peripheral.connect((error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      const characteristics = await new Promise<NobleCharacteristic[]>((resolve, reject) => {
        peripheral.discoverSomeServicesAndCharacteristics(
          serviceUuids,
          characteristicUuids,
          (error: Error | null, _services: unknown[], chars: NobleCharacteristic[]) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(chars || []);
          }
        );
      });

      const characteristic = characteristics[0];
      if (!characteristic) {
        return null;
      }

      const data = await new Promise<Buffer>((resolve, reject) => {
        characteristic.read((error: Error | null, value: Buffer) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(value);
        });
      });

      const parsed = JSON.parse(data.toString('utf8')) as unknown;
      if (!isValidBlePayload(parsed)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    } finally {
      try {
        peripheral.disconnect();
      } catch {
        // ignore disconnect issues
      }
    }
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;

    if (this.noble) {
      this.noble.stopScanning();
      if (this.nobleStateHandler) {
        this.noble.removeListener('stateChange', this.nobleStateHandler);
      }
      if (this.nobleDiscoverHandler) {
        this.noble.removeListener('discover', this.nobleDiscoverHandler);
      }
    }

    if (this.bleno) {
      if (this.blenoStateHandler) {
        this.bleno.removeListener('stateChange', this.blenoStateHandler);
      }
      this.bleno.stopAdvertising();
    }

    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }
}

export async function createBleDiscovery(identity: Identity, tcpPort: number, peerTable: PeerTable): Promise<BleDiscovery | null> {
  const ble = new BleDiscovery(identity, tcpPort, peerTable);
  const started = await ble.start().catch(() => false);
  if (!started) {
    return null;
  }
  return ble;
}
