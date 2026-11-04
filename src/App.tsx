import { useEffect } from 'react';
import { useApp, type Route } from './store/appStore';
import { bootstrap } from './store/persistence';
import { EditorScreen } from './features/editor/EditorScreen';
import { ShelfScreen } from './features/shelf/ShelfScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { DialogHost, Toast } from './ui/Overlays';
import { Icon } from './ui/Icon';

const NAV: { id: Route; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'editor', label: 'エディタ', icon: 'edit' },
  { id: 'shelf', label: '棚', icon: 'shelf' },
  { id: 'settings', label: '設定', icon: 'gear' },
];

function routeFromHash(): Route {
  const h = location.hash.replace('#/', '');
  return h === 'shelf' || h === 'settings' ? h : 'editor';
}

export function App() {
  const route = useApp((s) => s.route);
  const ready = useApp((s) => s.ready);
  const setRoute = useApp((s) => s.setRoute);

  useEffect(() => {
    setRoute(routeFromHash());
    const onHash = () => useApp.setState({ route: routeFromHash() });
    window.addEventListener('hashchange', onHash);
    bootstrap().catch((e) => {
      console.error(e);
      useApp.getState().showToast('データの読み込みに失敗しました');
      useApp.getState().setReady();
    });
    return () => window.removeEventListener('hashchange', onHash);
  }, [setRoute]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" aria-label="SOLE FORGE">
          <span className="brand-mark">SF</span>
          <span className="brand-name">SOLE FORGE</span>
        </div>
        <nav className="nav" aria-label="画面切り替え">
          {NAV.map((n) => (
            <button key={n.id} className={route === n.id ? 'active' : ''} aria-current={route === n.id ? 'page' : undefined} onClick={() => setRoute(n.id)} data-nav={n.id}>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {!ready ? (
          <div className="loading">
            <span className="sticker">LOADING</span>
          </div>
        ) : route === 'editor' ? (
          <EditorScreen />
        ) : route === 'shelf' ? (
          <ShelfScreen />
        ) : (
          <SettingsScreen />
        )}
      </main>
      <Toast />
      <DialogHost />
    </div>
  );
}
