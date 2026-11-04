import Dexie, { type EntityTable } from 'dexie';
import type { SneakerDesign } from '../models/types';

export interface BlobRecord {
  key: string; // 'img:<uuid>' | 'thumb:<designId>'
  blob: Blob;
  type: string;
  createdAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class SoleForgeDB extends Dexie {
  designs!: EntityTable<SneakerDesign, 'id'>;
  blobs!: EntityTable<BlobRecord, 'key'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(name = 'sole-forge') {
    super(name);
    this.version(1).stores({
      designs: 'id, shelfOrder, updatedAt, favorite, name',
      blobs: 'key, createdAt',
      settings: 'key',
    });
  }
}

let _db: SoleForgeDB | null = null;
export function getDB(): SoleForgeDB {
  if (!_db) _db = new SoleForgeDB();
  return _db;
}
/** テスト用: 別名の DB に差し替える */
export function setDB(db: SoleForgeDB) {
  _db = db;
}
