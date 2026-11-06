import { useEffect, useState } from 'react';
import { exportAll, importAll } from '../../db/backup';
import { clearAll, setSetting } from '../../db/repo';
import { getDB } from '../../db/db';
import { useApp, confirmDialog } from '../../store/appStore';
import { flushSave, newDesign } from '../../store/persistence';
import { downloadBlob, stamp } from '../../lib/download';
import { ScalePicker, BG_OPTIONS, BASE_EXPORT_SIZE } from '../editor/ExportDialog';
import { Icon } from '../../ui/Icon';
import { BASE_MODEL_IDS, countTriangles, getBaseModel, getGeometries } from '../../models';

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function SettingsScreen() {
  const toast = useApp((s) => s.showToast);
  const scale = useApp((s) => s.exportScale);
  const bg = useApp((s) => s.exportBg);
  const setScale = useApp((s) => s.setExportScale);
  const setBg = useApp((s) => s.setExportBg);
  const bump = useApp((s) => s.bumpShelf);
  const [stats, setStats] = useState<{ usage?: number; quota?: number; designs: number; images: number; imageBytes: number; persisted?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [swState, setSwState] = useState('確認中');

  const refresh = async () => {
    const db = getDB();
    const [designs, blobs] = await Promise.all([db.designs.count(), db.blobs.toArray()]);
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : undefined;
    setStats({
      usage: est.usage,
      quota: est.quota,
      designs,
      images: blobs.filter((b) => b.key.startsWith('img:')).length,
      imageBytes: blobs.reduce((n, b) => n + b.blob.size, 0),
      persisted,
    });
  };

  useEffect(() => {
    void refresh();
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((r) => setSwState(r?.active ? '有効（オフライン対応済み）' : '未登録（開発モード）'));
    } else setSwState('非対応のブラウザ');
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const doExport = async () => {
    setBusy('書き出し中…');
    try {
      await flushSave();
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      downloadBlob(blob, `sole-forge-backup_${stamp()}.json`);
      toast(`${data.designs.length} 足を JSON に書き出しました`);
    } catch (e) {
      console.error(e);
      toast('書き出しに失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (file: File) => {
    setBusy('読み込み中…');
    try {
      await flushSave();
      const raw = JSON.parse(await file.text());
      const res = await importAll(raw);
      bump();
      toast(`読み込みました（追加 ${res.added} / 上書き ${res.replaced}）`);
      await refresh();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const tris = Math.max(...BASE_MODEL_IDS.map((id) => countTriangles(getGeometries(getBaseModel(id)))));

  return (
    <div className="page">
      <div className="settings">
        <h1 className="page-title">SETTINGS</h1>

        <section className="card">
          <h2>バックアップ（JSON）</h2>
          <p className="muted small">全作品を、貼った画像ごと 1 つの JSON にまとめます。別の端末で読み込めば復元できます（同じ作品は上書き）。</p>
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => void doExport()} disabled={!!busy} data-testid="export-json">
              <Icon name="download" size={16} /> JSON 書き出し
            </button>
            <label className="btn file-btn">
              <Icon name="upload" size={16} /> JSON 読み込み
              <input
                type="file"
                accept="application/json,.json"
                data-testid="import-json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void doImport(f);
                }}
              />
            </label>
            {busy && <span className="progress">{busy}</span>}
          </div>
        </section>

        <section className="card">
          <h2>画像書き出し</h2>
          <div className="label">既定の解像度（単体 {BASE_EXPORT_SIZE * scale}px）</div>
          <ScalePicker
            value={scale}
            onChange={(s) => {
              setScale(s);
              void setSetting('exportScale', s);
            }}
          />
          <div className="label">単体書き出しの背景</div>
          <div className="seg wrap">
            {BG_OPTIONS.map((o) => (
              <button
                key={o.id}
                className={bg === o.value ? 'active' : ''}
                onClick={() => {
                  setBg(o.value);
                  void setSetting('exportBg', o.value);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>ストレージ</h2>
          {stats ? (
            <>
              {stats.usage !== undefined && stats.quota ? (
                <>
                  <div className="meter" aria-label="ストレージ使用率">
                    <span style={{ width: `${Math.min(100, (stats.usage / stats.quota) * 100).toFixed(2)}%` }} />
                  </div>
                  <p className="small muted">
                    {fmt(stats.usage)} / {fmt(stats.quota)} 使用中（アプリ本体のキャッシュを含む）
                  </p>
                </>
              ) : (
                <p className="small muted">このブラウザでは使用量を取得できません</p>
              )}
              <dl className="kv">
                <dt>作品数</dt>
                <dd data-testid="design-count">{stats.designs} 足</dd>
                <dt>画像・サムネイル</dt>
                <dd>
                  {stats.images} 枚の画像 / 合計 {fmt(stats.imageBytes)}
                </dd>
                <dt>永続化</dt>
                <dd>{stats.persisted === undefined ? '不明' : stats.persisted ? '有効（ブラウザに自動削除されにくい）' : '未設定'}</dd>
              </dl>
              <div className="row gap wrap" style={{ marginTop: 12 }}>
                {stats.persisted === false && (
                  <button
                    className="btn"
                    onClick={async () => {
                      const ok = await navigator.storage.persist?.();
                      toast(ok ? '永続化を有効にしました' : 'ブラウザに許可されませんでした');
                      void refresh();
                    }}
                  >
                    永続化をリクエスト
                  </button>
                )}
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!(await confirmDialog('すべて削除', '全作品・画像・設定を削除します。先に JSON で書き出しておくことをおすすめします。', true))) return;
                    await clearAll();
                    await newDesign();
                    bump();
                    toast('すべて削除しました');
                    void refresh();
                  }}
                >
                  <Icon name="trash" size={16} /> すべてのデータを削除
                </button>
              </div>
            </>
          ) : (
            <p className="muted">計算中…</p>
          )}
        </section>

        <section className="card">
          <h2>このアプリについて</h2>
          <dl className="kv">
            <dt>バージョン</dt>
            <dd>SOLE FORGE {__APP_VERSION__}</dd>
            <dt>ネットワーク</dt>
            <dd>{online ? 'オンライン' : 'オフライン'}（アプリは外部と通信しません）</dd>
            <dt>オフライン</dt>
            <dd>{swState}</dd>
            <dt>ベースモデル</dt>
            <dd>
              {BASE_MODEL_IDS.map((id) => getBaseModel(id).label).join(' / ')}（最大 {tris.toLocaleString()} ポリゴン / 片足）
            </dd>
          </dl>
          <p className="small muted">形・ロゴ・柄はすべてオリジナルです。実在ブランドのシルエットやロゴは収録していません。</p>
        </section>
      </div>
    </div>
  );
}
